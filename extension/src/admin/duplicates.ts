/**
 * What the settings pages show of duplicate values (spec 6.2, point B E1), without the page: per stored value its
 * value id, revision, state and the fields that decide where passwords go and who may read them, so an editor can tell
 * a planted value from the real one before choosing which stays. Everything is unchecked data, shown as plain text:
 * cut, and marked for isolation (`<bdi>`) when it is stored text.
 */
import { readMachineClients } from '../model/machine-clients';
import { connectedHost, INVISIBLE } from '../model/schemas';
import type { StoredValue } from '../store/repository';
import { cut, describeEntry } from './machine-clients';

const MAX_SHOWN = 120;
const MAX_CLIENT = 40;

/** A stored part as text: `isolate` for stored text (show it in `<bdi>`), not for numbers and booleans. */
export interface ShownText {
    text: string;
    isolate: boolean;
}

export interface ShownField extends ShownText {
    /** The field's name in the stored value (fixed by the code, not stored data). */
    name: string;
    /** Not the same in every value. */
    differs: boolean;
    /** `backendUrl` only: the host the browser really connects to, when it differs from the written one. */
    host?: string;
    /** `backendUrl` only: contains invisible format characters. */
    invisible?: boolean;
}

/** A client the backend would enable with this value. */
export interface ShownClient {
    id: string;
    name: string;
    canRead: boolean;
    fingerprints: (string | null)[];
}

export interface ShownValue {
    valueId: number;
    revision: ShownText;
    state: 'ok' | 'invalid' | 'newer';
    /** Number of problems the read found. */
    issues: number;
    keepable: boolean;
    fields: ShownField[];
    /** Names of the other stored fields, if any. */
    otherFields?: ShownText;
    /** `access` only. */
    clients?: ShownClient[];
    disabledClients?: number;
}

/** `–` for a missing part; numbers and booleans as they are; anything else (text, objects) cut to 120 and isolated. */
export function shownText(value: unknown): ShownText {
    if (value === undefined) return { text: '–', isolate: false };
    if (typeof value === 'number' || typeof value === 'boolean') return { text: String(value), isolate: false };
    return { text: cut(typeof value === 'string' ? value : JSON.stringify(value), MAX_SHOWN), isolate: true };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function parsed(text: string): Record<string, unknown> {
    try {
        const raw: unknown = JSON.parse(text);
        return isObject(raw) ? raw : {};
    } catch {
        return {};
    }
}

const SETTINGS_FIELDS = ['backendUrl', 'oauthClientId', 'requirePasswordForPasswordChange', 'allowCustomPassword', 'passwordLength', 'texts'] as const;
const ACCESS_FIELDS = ['users', 'admins', 'service'] as const;
const KNOWN = { settings: new Set<string>(['schema', 'revision', ...SETTINGS_FIELDS]), access: new Set<string>(['schema', 'revision', 'groups', 'machineClients']) };

function fieldsOf(category: 'settings' | 'access', raw: Record<string, unknown>): Omit<ShownField, 'differs'>[] {
    if (category === 'access') {
        const groups = isObject(raw.groups) ? raw.groups : {};
        return ACCESS_FIELDS.map((role) => {
            const g = groups[role];
            return { name: `groups.${role}`, ...shownText(isObject(g) ? g.groupId : g) };
        });
    }
    return SETTINGS_FIELDS.map((name) => {
        const value = raw[name];
        const field: Omit<ShownField, 'differs'> = { name, ...shownText(value) };
        if (name === 'backendUrl' && typeof value === 'string') {
            const host = connectedHost(value);
            if (host !== null) field.host = cut(host, MAX_SHOWN);
            if (INVISIBLE.test(value)) field.invisible = true;
        }
        return field;
    });
}

function clientsOf(raw: Record<string, unknown>): { clients: ShownClient[]; disabledClients: number } {
    const read = readMachineClients(raw.machineClients);
    if (read.notAList) return { clients: [], disabledClients: 0 };
    const list = raw.machineClients as unknown[];
    const clients = read.entries
        .filter((e) => e.reasons.length === 0)
        .map((e) => {
            const client = read.clients.find((c) => c.id === e.id)!;
            const info = describeEntry(list[e.index]);
            return { id: cut(client.id, MAX_CLIENT), name: cut(client.name, MAX_CLIENT), canRead: info.canRead, fingerprints: info.fingerprints };
        });
    return { clients, disabledClients: read.entries.length - clients.length };
}

/** Every value as shown, in the order given; a field `differs` when not every value has the same text there. */
export function describeDuplicates(category: 'settings' | 'access', values: readonly StoredValue<unknown>[]): ShownValue[] {
    const shown = values.map((v) => {
        const raw = parsed(v.text);
        const others = Object.keys(raw).filter((k) => !KNOWN[category].has(k));
        const value: ShownValue = {
            valueId: v.valueId,
            revision: shownText(raw.revision),
            state: v.read.state,
            issues: v.read.state === 'newer' ? 0 : (v.read.issues?.length ?? 0),
            keepable: v.keepable,
            fields: fieldsOf(category, raw).map((f) => ({ ...f, differs: false })),
            ...(others.length > 0 ? { otherFields: shownText(others.join(', ')) } : {}),
            ...(category === 'access' ? clientsOf(raw) : {}),
        };
        return value;
    });
    for (const [i, f] of (shown[0]?.fields ?? []).entries()) {
        const differs = shown.some((s) => s.fields[i]!.text !== f.text || s.fields[i]!.isolate !== f.isolate);
        for (const s of shown) s.fields[i]!.differs = differs;
    }
    return shown;
}
