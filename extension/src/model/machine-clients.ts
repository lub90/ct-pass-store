import type { MachineClient } from './schemas';

/**
 * Reads the machine clients exactly like the backend (`AccessParser`, spec backend 3.2). The shared fixture
 * `shared/access-client-cases.json` pins the results; both sides test against that file.
 */

export type ClientReason =
    | 'not-an-object'
    | 'invalid-id'
    | 'duplicate-id'
    | 'missing-name'
    | 'invalid-created-at'
    | 'no-keys'
    | 'invalid-key'
    | 'invalid-permissions'
    | 'shared-key';

export const CLIENT_ID_PATTERN = /^[a-z0-9-]{3,40}$/;
export const PERMISSION_READ_ENTRIES = 'entries:read';

/** PHP's `trim()` default set: space, tab, LF, CR, NUL, vertical tab. Not NBSP, unlike JS `.trim()`. */
export const phpTrim = (s: string): string => s.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '');

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A real calendar date `YYYY-MM-DD` (year 0000 is not one, like PHP's `checkdate`). */
export function isCalendarDate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return false;
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
    return day <= days;
}

/**
 * The 32 key bytes (as a binary string, for comparing) of a canonical key, else `null`. After the PHP trim: standard
 * base64 with padding, or base64url with or without padding; decoding then re-encoding must give the same text.
 */
export function decodeKey(text: string): string | null {
    const t = phpTrim(text);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(t) && !/^[A-Za-z0-9_-]{43}=?$/.test(t)) return null;
    const std = t.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    let raw: string;
    try {
        raw = atob(`${std}=`);
    } catch {
        return null;
    }
    if (raw.length !== 32) return null;
    return btoa(raw).replace(/=+$/, '') === std ? raw : null;
}

export interface UnusableClient {
    /** Position in the stored `machineClients` list. */
    index: number;
    /** The raw `id`, if it is a string (so the UI can name the entry). */
    id?: string;
    /** Why the backend disables it. Never empty. */
    reasons: ClientReason[];
}

export interface ClientsRead {
    /** The clients the backend enables. */
    clients: MachineClient[];
    /** The reason codes of every stored entry, in order (empty = fine, or disabled only by a later duplicate id). */
    entries: { index: number; id?: string; reasons: ClientReason[] }[];
    /** Every entry that is not in `clients`. */
    unusable: UnusableClient[];
    /** `machineClients` exists but isn't a list: all clients are disabled. */
    notAList: boolean;
    /** Unknown permissions that were dropped from enabled clients, as texts. */
    dropped: string[];
}

export function readMachineClients(raw: unknown): ClientsRead {
    if (raw === undefined || raw === null) return { clients: [], entries: [], unusable: [], notAList: false, dropped: [] };
    if (!Array.isArray(raw)) return { clients: [], entries: [], unusable: [], notAList: true, dropped: [] };

    const seen = new Set<string>();
    const entries: ClientsRead['entries'] = [];
    const enabled = new Map<string, { index: number; client: MachineClient }>();
    const disabledByDuplicate = new Set<number>();
    const dropped: string[] = [];

    raw.forEach((entry: unknown, index) => {
        const id = isObject(entry) && typeof entry.id === 'string' ? entry.id : undefined;
        const reasons = entryReasons(entry, seen);
        entries.push(id === undefined ? { index, reasons } : { index, id, reasons });
        if (id !== undefined) seen.add(id);
        if (reasons.length > 0) {
            // A duplicate disables the earlier entry as well: which of the two is meant can't be decided.
            const earlier = id === undefined ? undefined : enabled.get(id);
            if (earlier) {
                enabled.delete(id as string);
                disabledByDuplicate.add(earlier.index);
            }
            return;
        }
        const e = entry as Record<string, unknown>;
        const given = Array.isArray(e.permissions) ? (e.permissions as unknown[]) : [];
        const permissions = [...new Set(given.filter((p) => p === PERMISSION_READ_ENTRIES))] as 'entries:read'[];
        if (given.some((p) => p !== PERMISSION_READ_ENTRIES)) dropped.push(`machineClients.${index}.permissions: unknown permission dropped`);
        const client = {
            ...e,
            id: e.id as string,
            name: phpTrim(e.name as string),
            publicKeys: (e.publicKeys as string[]).map(phpTrim),
            permissions,
            createdAt: e.createdAt as string,
        } as MachineClient;
        enabled.set(client.id, { index, client });
    });

    // Clients sharing a key (as bytes) are all disabled.
    const owners = new Map<string, string[]>();
    for (const { client } of enabled.values()) {
        for (const key of new Set(client.publicKeys.map((k) => decodeKey(k) ?? ''))) {
            owners.set(key, [...(owners.get(key) ?? []), client.id]);
        }
    }
    for (const ids of owners.values()) {
        if (ids.length < 2) continue;
        for (const id of ids) {
            const hit = enabled.get(id);
            if (!hit) continue;
            enabled.delete(id);
            entries[hit.index]?.reasons.push('shared-key');
        }
    }

    const enabledIndices = new Set([...enabled.values()].map((e) => e.index));
    const unusable: UnusableClient[] = entries
        .filter((e) => !enabledIndices.has(e.index))
        .map((e) => {
            const reasons: ClientReason[] = e.reasons.length > 0 ? e.reasons : ['duplicate-id'];
            return e.id === undefined ? { index: e.index, reasons } : { index: e.index, id: e.id, reasons };
        });
    return {
        clients: [...enabled.values()].sort((a, b) => a.index - b.index).map((e) => e.client),
        entries,
        unusable,
        notAList: false,
        dropped,
    };
}

function entryReasons(entry: unknown, seen: ReadonlySet<string>): ClientReason[] {
    if (!isObject(entry)) return ['not-an-object'];
    const reasons: ClientReason[] = [];
    const id = entry.id;
    if (typeof id !== 'string' || !CLIENT_ID_PATTERN.test(id)) reasons.push('invalid-id');
    else if (seen.has(id)) reasons.push('duplicate-id');
    if (typeof entry.name !== 'string' || phpTrim(entry.name) === '') reasons.push('missing-name');
    if (!isCalendarDate(entry.createdAt)) reasons.push('invalid-created-at');
    const keys = entry.publicKeys;
    if (!Array.isArray(keys) || keys.length === 0) reasons.push('no-keys');
    else if (keys.some((k: unknown) => typeof k !== 'string' || decodeKey(k) === null)) reasons.push('invalid-key');
    const permissions = entry.permissions;
    if (permissions !== undefined && permissions !== null && !Array.isArray(permissions)) reasons.push('invalid-permissions');
    return reasons;
}
