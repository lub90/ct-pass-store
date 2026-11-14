/**
 * What the settings pages show of duplicate values (spec 6.2, point B E1), without the page: per stored value its
 * value id, revision, state and the fields that decide where passwords go and who may read them, so an editor can tell
 * a planted value from the real one before choosing which stays. Everything is unchecked data, shown as plain text:
 * cut, and marked for isolation (`<bdi>`) when it is stored text.
 */
import { readMachineClients } from '../model/machine-clients';
import { connectedHost, INVISIBLE, newBackendUrlProblem } from '../model/schemas';
import type { StoredValue } from '../store/repository';
import { cut, describeEntry } from './machine-clients';

const MAX_SHOWN = 120;
const MAX_CLIENT = 40;
/** A DNS name has at most 253 characters: a host is shown in full up to that, else cut from the left (end visible). */
const MAX_HOST = 253;

/** A stored part as text: `isolate` for stored text (show it in `<bdi>`), not for numbers and booleans. */
export interface ShownText {
    text: string;
    isolate: boolean;
}

export interface ShownField extends ShownText {
    /** The field's name in the stored value (fixed by the code, not stored data). */
    name: string;
    /** Not the same in every value (compared on the full stored values, not the cut text). */
    differs: boolean;
    /** The stored value is a boolean (shown as yes/no). */
    bool?: boolean;
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
    /** Why it can't be kept: a `backendUrl` a save would refuse (S6), or anything else (`StoredValue.keepable`). */
    notKeepable?: 'address' | 'other';
    /** The highest value id: the value created last (S2), the one most likely planted. */
    newest: boolean;
    fields: ShownField[];
    /** Names of the other stored fields, if any. */
    otherFields?: ShownText;
    /** `access` only. */
    clients?: ShownClient[];
    disabledClients?: number;
    /** `access` only: the set of enabled clients isn't the same in every value (full ids, names, keys, permissions). */
    clientsDiffer?: boolean;
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

/** A field with its full stored value (`full`, what `differs` compares). */
type RawField = Omit<ShownField, 'differs'> & { full: string };

/** The full value as a comparable text: type and content (`undefined` for a missing one). */
const fullText = (value: unknown): string => (value === undefined ? 'undefined' : `${typeof value}:${JSON.stringify(value)}`);

function shownField(name: string, value: unknown): RawField {
    return { name, ...shownText(value), ...(typeof value === 'boolean' ? { bool: value } : {}), full: fullText(value) };
}

const cutLeft = (text: string, max: number): string => (text.length > max ? `…${text.slice(-(max - 1))}` : text);

function fieldsOf(category: 'settings' | 'access', raw: Record<string, unknown>): RawField[] {
    if (category === 'access') {
        const groups = isObject(raw.groups) ? raw.groups : {};
        return ACCESS_FIELDS.map((role) => {
            const g = groups[role];
            return shownField(`groups.${role}`, isObject(g) ? g.groupId : g);
        });
    }
    return SETTINGS_FIELDS.map((name) => {
        const value = raw[name];
        const field = shownField(name, value);
        if (name === 'backendUrl' && typeof value === 'string') {
            const host = connectedHost(value);
            if (host !== null) field.host = cutLeft(host, MAX_HOST);
            if (INVISIBLE.test(value)) field.invisible = true;
        }
        return field;
    });
}

/** The enabled clients, shown, plus their full set as one comparable text (sorted, so the order doesn't matter). */
function clientsOf(raw: Record<string, unknown>): { clients: ShownClient[]; disabledClients: number; set: string } {
    const read = readMachineClients(raw.machineClients);
    if (read.notAList) return { clients: [], disabledClients: 0, set: '[]' };
    const list = raw.machineClients as unknown[];
    const clients = read.entries
        .filter((e) => e.reasons.length === 0)
        .map((e) => {
            const client = read.clients.find((c) => c.id === e.id)!;
            const info = describeEntry(list[e.index]);
            return { id: cut(client.id, MAX_CLIENT), name: cut(client.name, MAX_CLIENT), canRead: info.canRead, fingerprints: info.fingerprints };
        });
    const set = JSON.stringify(read.clients.map((c) => JSON.stringify([c.id, c.name, [...c.publicKeys].sort(), [...c.permissions].sort()])).sort());
    return { clients, disabledClients: read.entries.length - clients.length, set };
}

/** Every value as shown, in the order given; a field `differs` when not every value has the same text there. */
export function describeDuplicates(category: 'settings' | 'access', values: readonly StoredValue<unknown>[]): ShownValue[] {
    const newest = Math.max(...values.map((v) => v.valueId));
    const described = values.map((v) => {
        const raw = parsed(v.text);
        const others = Object.keys(raw).filter((k) => !KNOWN[category].has(k));
        const fields = fieldsOf(category, raw);
        const clients = category === 'access' ? clientsOf(raw) : null;
        const badAddress = category === 'settings' && typeof raw.backendUrl === 'string' && newBackendUrlProblem(raw.backendUrl) !== null;
        const value: ShownValue = {
            valueId: v.valueId,
            revision: shownText(raw.revision),
            state: v.read.state,
            issues: v.read.state === 'newer' ? 0 : (v.read.issues?.length ?? 0),
            keepable: v.keepable,
            ...(v.keepable ? {} : { notKeepable: badAddress ? ('address' as const) : ('other' as const) }),
            newest: v.valueId === newest,
            fields: fields.map((f) => {
                const shownOnly: Partial<RawField> & { differs: boolean } = { ...f, differs: false };
                delete shownOnly.full;
                return shownOnly as ShownField;
            }),
            ...(others.length > 0 ? { otherFields: shownText(others.join(', ')) } : {}),
            ...(clients ? { clients: clients.clients, disabledClients: clients.disabledClients } : {}),
        };
        return { value, full: fields.map((f) => f.full), set: clients?.set };
    });
    for (const [i] of (described[0]?.full ?? []).entries()) {
        const differs = described.some((d) => d.full[i] !== described[0]!.full[i]);
        for (const d of described) d.value.fields[i]!.differs = differs;
    }
    if (category === 'access') {
        const clientsDiffer = described.some((d) => d.set !== described[0]!.set);
        for (const d of described) d.value.clientsDiffer = clientsDiffer;
    }
    return described.map((d) => d.value);
}
