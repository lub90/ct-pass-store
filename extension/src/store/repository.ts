import * as v from 'valibot';
import { decodeKey, readMachineClients, type UnusableClient } from '@/model/machine-clients';
import { isOldLayout } from '@/model/layout';
import { InvalidValueError, ConflictError, ValueTooLargeError } from '@/model/errors';
import { AccessSchema, RETIRED_KEYS, SCHEMA_VERSION, SettingsSchema, SettingsTextsSchema, type AccessV2, type MachineClient, type SettingsV2 } from '@/model/schemas';
import type { KvBackend } from './kv';

export const VALUE_LIMIT = 10_000;

export type Read<T> =
    | { state: 'missing' }
    /** `revision`: the stored integer revision, if any, so an explicit repair save can pass it as `expectedRevision`. */
    | { state: 'invalid'; issues: string[]; revision?: number }
    | { state: 'newer'; schema: number }
    /**
     * `issues`: parts of the stored value were left out or dropped (settings: invalid `texts`, so the defaults apply;
     * access: unusable machine clients and unknown permissions). The value never carries them. A save removes dropped
     * texts and permissions; `unusable` (access only: stored entries the backend disables, with their reasons) are
     * kept unchanged unless `saveAccess` is told to drop them.
     */
    | { state: 'ok'; value: T; valueId: number; duplicates: number; issues?: string[]; unusable?: UnusableClient[] };

type Schema = typeof SettingsSchema | typeof AccessSchema;

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
     * `dropUnusable`: indices (`Read.unusable[].index` of the read this save is based on) of stored entries the
     * backend can't use that are to be removed. All other unusable entries are kept unchanged.
     */
    saveAccess(next: AccessV2, expectedRevision: number, dropUnusable: readonly number[] = []): Promise<void> {
        return this.save('access', AccessSchema, next, expectedRevision, dropUnusable);
    }

    /** Spec 6.3 on the newest `settings` value and the category names. KV errors propagate. */
    async oldLayout(): Promise<boolean> {
        const [names, { newest }] = await Promise.all([this.kv.categoryNames(), this.load('settings')]);
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

    /** Highest value ID first. */
    private async load(category: string) {
        const values = (await this.kv.values(category)).sort((a, b) => b.id - a.id);
        return { newest: values[0], duplicates: values.slice(1) };
    }

    private async read<S extends Schema>(category: 'settings' | 'access', schema: S): Promise<Read<v.InferOutput<S>>> {
        const { newest, duplicates } = await this.load(category);
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
            const revision = isObject(raw) && Number.isInteger(raw.revision) ? (raw.revision as number) : undefined;
            return revision === undefined ? { state: 'invalid', issues: issuesOf(result.issues) } : { state: 'invalid', issues: issuesOf(result.issues), revision };
        }
        const ok = { state: 'ok' as const, value: result.output as v.InferOutput<S>, valueId: newest.id, duplicates: duplicates.length };
        const withUnusable = unusable && unusable.length > 0 ? { ...ok, unusable } : ok;
        return issues.length > 0 ? { ...withUnusable, issues } : withUnusable;
    }

    private async save<S extends Schema>(category: 'settings' | 'access', schema: S, next: v.InferOutput<S>, expectedRevision: number, dropUnusable: readonly number[] = []): Promise<void> {
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
                    if (typeof revision === 'number' && Number.isInteger(revision)) currentRevision = revision;
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
        if (schema === AccessSchema && Array.isArray(stored.machineClients) && Array.isArray(merged.machineClients)) {
            const rejected = readMachineClients(stored.machineClients)
                .unusable.filter((u) => !dropUnusable.includes(u.index))
                .map((u) => (stored.machineClients as unknown[])[u.index]);
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
