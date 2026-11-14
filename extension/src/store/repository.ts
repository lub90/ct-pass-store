import * as v from 'valibot';
import { decodeKey, phpTrim, readMachineClients, type ClientReason, type UnusableClient } from '@/model/machine-clients';
import { isOldLayout } from '@/model/layout';
import { InvalidValueError, ConflictError, ValueTooLargeError } from '@/model/errors';
import { AccessSchema, BIDI_CONTROLS, INVISIBLE, isUsableRevision, RETIRED_KEYS, SCHEMA_VERSION, SettingsSchema, SettingsTextsSchema, type AccessV2, type MachineClient, type SettingsV2 } from '@/model/schemas';
import type { CtValue } from '@/ct/types';
import type { KvBackend } from './kv';

export const VALUE_LIMIT = 10_000;

export type Read<T> =
    | { state: 'missing' }
    /**
     * `revision`: the stored integer revision, if any, so an explicit repair save can pass it as `expectedRevision`.
     * `repair` (settings only, for a value with `schema` 2 and such a revision): the known fields that are valid on
     * their own (`kept`) and the ones present but invalid (`broken`), so a page can rebuild a value without losing
     * what it may not write. Invalid `texts` are dropped as on an `ok` read (an issue, in neither list).
     * `unusable` and `clientEntries` (access only, when `machineClients` is a list): as on an `ok` read, so the page
     * can still list every stored client, including those the backend enables although the value is invalid here.
     * `clientsRevision` (with `clientEntries`): what `removeClients` compares: the usable revision, 0 for a stored
     * revision that is no integer (as on save), none for an integer out of range (nothing can be removed then).
     */
    | { state: 'invalid'; issues: string[]; revision?: number; repair?: Repair<T>; unusable?: UnusableClient[]; clientEntries?: ClientEntry[]; clientsRevision?: number }
    | { state: 'newer'; schema: number }
    /**
     * `issues`: parts of the stored value were left out or dropped (settings: invalid `texts`, so the defaults apply;
     * access: unusable machine clients and unknown permissions). The value never carries them. A save removes dropped
     * texts and permissions; `unusable` (access only: stored entries the backend disables, with their reasons) are
     * kept unchanged unless `saveAccess` is told to drop them.
     */
    | { state: 'ok'; value: T; valueId: number; duplicates: number; issues?: string[]; unusable?: UnusableClient[]; clientEntries?: ClientEntry[] };

/**
 * One stored `machineClients` entry as read (access only), in stored order: its raw value (unchecked data, never
 * markup), the backend's reasons to disable it, and the parsed client if the backend enables it (reasons empty).
 */
export interface ClientEntry {
    index: number;
    id?: string;
    reasons: ClientReason[];
    raw: unknown;
    client?: MachineClient;
}

/**
 * An entry to drop: its index in the read, its raw id there (none if it had no string id) and, if given, the raw entry
 * as read (`ClientEntry.raw`): the stored entry at that index must still be exactly that.
 */
export interface DropRef {
    index: number;
    id?: string;
    entry?: unknown;
}

const rawId = (entry: unknown): string | undefined => (isObject(entry) && typeof entry.id === 'string' ? entry.id : undefined);
/** The stored entry at `ref.index` is still the one the read showed. */
const matches = (list: readonly unknown[], ref: DropRef): boolean =>
    Number.isInteger(ref.index) && ref.index >= 0 && ref.index < list.length && rawId(list[ref.index]) === ref.id && (!('entry' in ref) || JSON.stringify(list[ref.index]) === JSON.stringify(ref.entry));

export interface Repair<T> {
    kept: Partial<T>;
    broken: string[];
    /** The stored values of the `broken` fields, as they are (unchecked data, never shown as markup). */
    brokenValues: Record<string, unknown>;
}

type Schema = typeof SettingsSchema | typeof AccessSchema;

/** The known settings fields (other than `schema` and `revision`) checked one by one. */
function repairOf(raw: Record<string, unknown>): Repair<SettingsV2> {
    const kept: Record<string, unknown> = {};
    const broken: string[] = [];
    const brokenValues: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(SettingsSchema.entries)) {
        if (key === 'schema' || key === 'revision' || !(key in raw)) continue;
        const field = v.safeParse(entry, raw[key]);
        if (field.success) kept[key] = field.output;
        else {
            broken.push(key);
            brokenValues[key] = raw[key];
        }
    }
    return { kept: kept as Partial<SettingsV2>, broken, brokenValues };
}

/** Removes trailing slashes of `backendUrl` (backend spec 3.2). */
function normalize<T>(value: T): T {
    const url = (value as { backendUrl?: unknown }).backendUrl;
    return typeof url === 'string' ? { ...value, backendUrl: url.replace(/\/+$/, '') } : value;
}

const MAX_ISSUE = 200;
const clip = (text: string): string => (text.length > MAX_ISSUE ? `${text.slice(0, MAX_ISSUE - 1)}…` : text);

/** Valibot messages echo the received value, so each one is cut to a sane length. */
const issuesOf = (issues: v.BaseIssue<unknown>[]): string[] =>
    issues.map((i) => clip(`${i.path?.map((p) => String(p.key)).join('.') || '(value)'}: ${i.message}`));

/** A new client that shares an id or a (decodable) key with a preserved entry, as text; `undefined` if none does. */
function collision(clients: readonly MachineClient[], preserved: readonly unknown[]): string | undefined {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const entry of preserved) {
        if (!isObject(entry)) continue;
        if (typeof entry.id === 'string') ids.add(entry.id);
        if (Array.isArray(entry.publicKeys)) {
            for (const key of entry.publicKeys) {
                const bytes = typeof key === 'string' ? decodeKey(key) : null;
                if (bytes !== null) keys.add(bytes);
            }
        }
    }
    for (const c of clients) {
        if (ids.has(c.id)) return clip(`machineClients: id "${c.id}" collides with a stored client that couldn't be read; fix or remove that one first`);
        if (c.publicKeys.some((k) => keys.has(decodeKey(k) ?? ''))) return clip(`machineClients: a public key of "${c.id}" is already used by a stored client that couldn't be read`);
    }
    return undefined;
}

type Loaded = { newest: CtValue | undefined; duplicates: CtValue[] };

/** Spec 6.3 on the newest raw `settings` value (broken JSON is no old layout) and the category names. */
function layoutOf(newest: CtValue | undefined, names: string[]): boolean {
    let raw: unknown = null;
    if (newest) {
        try {
            raw = JSON.parse(newest.value);
        } catch {
            raw = null;
        }
    }
    return isOldLayout(raw, names);
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The one-value categories `settings` and `access`: tolerant reads, strict conflict-checked writes (spec 6.2). */
export class ExtensionStore {
    private readonly kv: KvBackend;

    constructor(kv: KvBackend) {
        this.kv = kv;
    }

    readSettings(): Promise<Read<SettingsV2>> {
        return this.read('settings', SettingsSchema);
    }

    readAccess(): Promise<Read<AccessV2>> {
        return this.read('access', AccessSchema);
    }

    /** `next.revision` is ignored: the stored one is raised by 1. Unknown fields of the stored value survive. */
    saveSettings(next: SettingsV2, expectedRevision: number): Promise<void> {
        return this.save('settings', SettingsSchema, next, expectedRevision);
    }

    /**
     * `dropUnusable`: entries of `Read.unusable` (index and raw id of the read this save is based on) the backend
     * can't use that are to be removed. All other unusable entries are kept unchanged. If the stored entry at such an
     * index isn't unusable any more or has another raw id, nothing is written (`ConflictError`): a stale index never
     * drops another entry, even if the revision wasn't raised.
     */
    saveAccess(next: AccessV2, expectedRevision: number, dropUnusable: readonly DropRef[] = []): Promise<void> {
        return this.save('access', AccessSchema, next, expectedRevision, dropUnusable);
    }

    /**
     * Removes stored `machineClients` entries (enabled or not) from a value in any state with a usable revision, even
     * one the extension reads as invalid (spec 4.7): only `machineClients` and `revision` change; every other stored
     * field stays as stored (no schema repair). Refused with `ConflictError` if the revision or any entry no longer
     * matches the read (index, raw id and, if given, the entry itself); nothing is written then.
     */
    async removeClients(expectedRevision: number, drop: readonly DropRef[]): Promise<void> {
        if (drop.length === 0) throw new InvalidValueError(['machineClients: nothing to remove']);
        const { newest, duplicates } = await this.load('access');
        if (!newest) throw new ConflictError(0);
        let raw: unknown;
        try {
            raw = JSON.parse(newest.value);
        } catch {
            throw new InvalidValueError(['(value): not valid JSON']);
        }
        if (!isObject(raw)) throw new InvalidValueError(['(value): not an object']);
        if (typeof raw.schema === 'number' && raw.schema > SCHEMA_VERSION) throw new InvalidValueError([`stored value has newer schema ${raw.schema}`]);
        // As on save: an integer out of range is refused; anything that is no integer counts as 0.
        if (Number.isInteger(raw.revision) && !isUsableRevision(raw.revision)) throw new InvalidValueError([`stored revision ${clip(String(raw.revision))} is out of range`]);
        const current = isUsableRevision(raw.revision) ? raw.revision : 0;
        if (current !== expectedRevision) throw new ConflictError(current);
        const list = raw.machineClients;
        if (!Array.isArray(list) || !drop.every((ref) => matches(list, ref))) throw new ConflictError(current);
        const gone = new Set(drop.map((ref) => ref.index));
        const json = JSON.stringify({ ...raw, machineClients: list.filter((_, i) => !gone.has(i)), revision: expectedRevision + 1 });
        if (json.length > VALUE_LIMIT) throw new ValueTooLargeError(json.length, VALUE_LIMIT);
        await this.kv.update('access', newest.id, json);
        for (const d of duplicates) await this.kv.delete('access', d.id);
    }

    /** Startup: spec 6.3 (old layout) and `readSettings()` from one listing of `settings`. KV errors propagate. */
    async readStartup(): Promise<{ oldLayout: boolean; settings: Read<SettingsV2> }> {
        const [names, loaded] = await Promise.all([this.kv.categoryNames(), this.load('settings')]);
        return { oldLayout: layoutOf(loaded.newest, names), settings: this.parse('settings', SettingsSchema, loaded) };
    }

    /** Highest value ID first. */
    private async load(category: string): Promise<Loaded> {
        const values = (await this.kv.values(category)).sort((a, b) => b.id - a.id);
        return { newest: values[0], duplicates: values.slice(1) };
    }

    private async read<S extends Schema>(category: 'settings' | 'access', schema: S): Promise<Read<v.InferOutput<S>>> {
        return this.parse(category, schema, await this.load(category));
    }

    private parse<S extends Schema>(category: 'settings' | 'access', schema: S, { newest, duplicates }: Loaded): Read<v.InferOutput<S>> {
        if (!newest) return { state: 'missing' };
        let raw: unknown;
        try {
            raw = JSON.parse(newest.value);
        } catch {
            return { state: 'invalid', issues: ['(value): not valid JSON'] };
        }
        const version = (raw as { schema?: unknown } | null)?.schema;
        if (typeof version === 'number' && version > SCHEMA_VERSION) return { state: 'newer', schema: version };
        const issues: string[] = [];
        let unusable: UnusableClient[] | undefined;
        let clientEntries: ClientEntry[] | undefined;
        if (isObject(raw)) {
            const rest = { ...raw };
            for (const key of RETIRED_KEYS[category]) delete rest[key];
            if (schema === SettingsSchema && 'texts' in rest) {
                const texts = v.safeParse(SettingsTextsSchema, rest.texts);
                if (!texts.success) {
                    delete rest.texts;
                    issues.push(...issuesOf(texts.issues).map((i) => clip(`texts.${i}`)));
                }
            }
            if (schema === AccessSchema) {
                const parsed = readMachineClients(rest.machineClients);
                if (!parsed.notAList) {
                    const stored = Array.isArray(rest.machineClients) ? (rest.machineClients as unknown[]) : [];
                    clientEntries = parsed.entries.map((e) => {
                        const client = e.reasons.length === 0 ? parsed.clients.find((c) => c.id === e.id) : undefined;
                        return { ...e, reasons: [...e.reasons], raw: stored[e.index], ...(client ? { client } : {}) };
                    });
                    rest.machineClients = parsed.clients;
                    unusable = parsed.unusable;
                    issues.push(...parsed.dropped);
                    issues.push(...parsed.unusable.map((u) => `machineClients.${u.index}: ${u.reasons.join(', ')}`));
                }
            }
            raw = rest;
        }
        const result = v.safeParse(schema, raw);
        if (!result.success) {
            const revision = isObject(raw) && isUsableRevision(raw.revision) ? raw.revision : undefined;
            const rawRevision = isObject(raw) ? raw.revision : undefined;
            const clientsRevision = isUsableRevision(rawRevision) ? rawRevision : Number.isInteger(rawRevision) ? undefined : 0;
            const listed = {
                ...(unusable && unusable.length > 0 ? { unusable } : {}),
                ...(clientEntries ? { clientEntries, ...(clientsRevision === undefined ? {} : { clientsRevision }) } : {}),
            };
            if (revision === undefined) return { state: 'invalid', issues: [...issues, ...issuesOf(result.issues)], ...listed };
            const invalid = { state: 'invalid' as const, issues: [...issues, ...issuesOf(result.issues)], revision, ...listed };
            if (schema !== SettingsSchema || !isObject(raw) || raw.schema !== SCHEMA_VERSION) return invalid;
            return { ...invalid, repair: repairOf(raw) as Repair<v.InferOutput<S>> };
        }
        const ok = { state: 'ok' as const, value: result.output as v.InferOutput<S>, valueId: newest.id, duplicates: duplicates.length };
        const withUnusable = { ...ok, ...(unusable && unusable.length > 0 ? { unusable } : {}), ...(clientEntries ? { clientEntries } : {}) };
        return issues.length > 0 ? { ...withUnusable, issues } : withUnusable;
    }

    private async save<S extends Schema>(category: 'settings' | 'access', schema: S, next: v.InferOutput<S>, expectedRevision: number, dropUnusable: readonly DropRef[] = []): Promise<void> {
        // Strict: validate what the caller hands in, before touching the store.
        const checked = v.safeParse(schema, normalize(next));
        if (!checked.success) throw new InvalidValueError(issuesOf(checked.issues));

        // Read right before writing (no version/ETag exists, so this narrows the race as far as possible).
        const { newest, duplicates } = await this.load(category);
        let stored: Record<string, unknown> = {};
        let currentRevision = 0;
        if (newest) {
            try {
                const raw: unknown = JSON.parse(newest.value);
                if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                    stored = raw as Record<string, unknown>;
                    const revision = stored.revision;
                    if (isUsableRevision(revision)) currentRevision = revision;
                    // An integer no save can compare and raise exactly: refused, never treated as 0 (a stale save
                    // with expected 0 would overwrite it). The setup deals with it.
                    else if (Number.isInteger(revision)) throw new InvalidValueError([`stored revision ${String(revision)} is out of range`]);
                    const version = stored.schema;
                    if (typeof version === 'number' && version > SCHEMA_VERSION) {
                        throw new InvalidValueError([`stored value has newer schema ${version}`]);
                    }
                }
            } catch (error) {
                if (error instanceof InvalidValueError) throw error;
                // Unreadable stored value: it gets replaced; its revision counts as 0.
            }
        }
        if (currentRevision !== expectedRevision) throw new ConflictError(currentRevision);

        // Known keys come only from `next` (an omitted optional field is removed); unknown stored fields survive.
        // Retired v1 fields never survive. Stored machine clients that read as invalid are kept unchanged.
        const retired = RETIRED_KEYS[category];
        const unknown = Object.fromEntries(Object.entries(stored).filter(([k]) => !(k in schema.entries) && !retired.includes(k)));
        const merged: Record<string, unknown> = { ...unknown, ...checked.output, revision: expectedRevision + 1 };
        for (const key of retired) delete merged[key];
        const storedClients = Array.isArray(stored.machineClients) ? (stored.machineClients as unknown[]) : null;
        if (dropUnusable.length > 0) {
            const now = storedClients ? readMachineClients(storedClients).unusable : [];
            const stale = dropUnusable.some((d) => !now.some((u) => u.index === d.index && u.id === d.id) || !matches(storedClients ?? [], d));
            if (stale) throw new ConflictError(currentRevision);
        }
        if (schema === SettingsSchema) {
            // A new or changed address must not carry invisible characters; a stored one is kept (the backend reads it).
            const url = (checked.output as SettingsV2).backendUrl;
            const before = typeof stored.backendUrl === 'string' ? stored.backendUrl.replace(/\/+$/, '') : undefined;
            if (url !== undefined && INVISIBLE.test(url) && url !== before) throw new InvalidValueError(['backendUrl: contains invisible characters']);
        }
        if (schema === AccessSchema) {
            // A new or changed name must not carry bidi controls; a stored one is kept as it is (the backend reads it).
            // Compared trimmed: the read trims names like the backend (a padded stored name comes back trimmed).
            const storedNames = new Map((storedClients ?? []).filter(isObject).map((c) => [c.id, typeof c.name === 'string' ? phpTrim(c.name) : c.name] as const));
            const bad = (checked.output as AccessV2).machineClients.find((c) => BIDI_CONTROLS.test(c.name) && storedNames.get(c.id) !== c.name);
            if (bad) throw new InvalidValueError([clip(`machineClients: the name of "${bad.id}" contains bidi control characters`)]);
        }
        if (schema === AccessSchema && storedClients && Array.isArray(merged.machineClients)) {
            const drop = new Set(dropUnusable.map((d) => d.index));
            const rejected = readMachineClients(storedClients)
                .unusable.filter((u) => !drop.has(u.index))
                .map((u) => storedClients[u.index]);
            const clash = collision(merged.machineClients as MachineClient[], rejected);
            if (clash) throw new InvalidValueError([clash]);
            merged.machineClients = [...merged.machineClients, ...rejected];
        }
        const json = JSON.stringify(merged);
        if (json.length > VALUE_LIMIT) throw new ValueTooLargeError(json.length, VALUE_LIMIT);

        // Value first, deletions last: an interruption leaves duplicates, never a lost value.
        if (newest) await this.kv.update(category, newest.id, json);
        else await this.kv.create(category, json);
        for (const d of duplicates) await this.kv.delete(category, d.id);
    }
}
