import * as v from 'valibot';
import { InvalidValueError, ConflictError, ValueTooLargeError } from '@/model/errors';
import { AccessSchema, MachineClientSchema, RETIRED_KEYS, SCHEMA_VERSION, SettingsSchema, SettingsTextsSchema, conflictingClients, type AccessV2, type MachineClient, type SettingsV2 } from '@/model/schemas';
import type { KvBackend } from './kv';

export const VALUE_LIMIT = 10_000;

export type Read<T> =
    | { state: 'missing' }
    | { state: 'invalid'; issues: string[] }
    | { state: 'newer'; schema: number }
    /**
     * `issues` (settings only): `texts` was invalid and was dropped, so the defaults apply; the value never carries
     * invalid texts. Saving it removes them from storage.
     */
    | { state: 'ok'; value: T; valueId: number; duplicates: number; issues?: string[] };

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

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Reads the machine clients one by one, like the backend: an invalid client (or one with a duplicate id or a shared
 * key) is left out and reported; an unknown permission is dropped from the client and reported. `rejected` holds the
 * stored entries that were left out, unchanged, so a save can keep them.
 */
function parseClients(list: unknown[]): { clients: MachineClient[]; rejected: unknown[]; issues: string[] } {
    const issues: string[] = [];
    const parsed: { index: number; client: MachineClient }[] = [];
    const rejectedIndices = new Set<number>();
    list.forEach((entry, index) => {
        let candidate = entry;
        if (isObject(entry) && Array.isArray(entry.permissions)) {
            const known = entry.permissions.filter((p) => p === 'entries:read');
            if (known.length !== entry.permissions.length) {
                issues.push(`machineClients.${index}.permissions: unknown permission dropped`);
                candidate = { ...entry, permissions: known };
            }
        }
        const result = v.safeParse(MachineClientSchema, candidate);
        if (result.success) parsed.push({ index, client: result.output });
        else {
            rejectedIndices.add(index);
            issues.push(...issuesOf(result.issues).map((i) => clip(`machineClients.${index}.${i}`)));
        }
    });
    const conflicts = conflictingClients(parsed.map((p) => p.client));
    parsed.forEach((p, n) => {
        if (conflicts.has(n)) {
            rejectedIndices.add(p.index);
            issues.push(`machineClients.${p.index}: duplicate id or shared public key, left out`);
        }
    });
    return {
        clients: parsed.filter((_, n) => !conflicts.has(n)).map((p) => p.client),
        rejected: list.filter((_, index) => rejectedIndices.has(index)),
        issues,
    };
}

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

    saveAccess(next: AccessV2, expectedRevision: number): Promise<void> {
        return this.save('access', AccessSchema, next, expectedRevision);
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
                if (rest.machineClients === undefined) rest.machineClients = [];
                else if (Array.isArray(rest.machineClients)) {
                    const parsed = parseClients(rest.machineClients);
                    rest.machineClients = parsed.clients;
                    issues.push(...parsed.issues);
                }
            }
            raw = rest;
        }
        const result = v.safeParse(schema, raw);
        if (!result.success) return { state: 'invalid', issues: issuesOf(result.issues) };
        const ok = { state: 'ok' as const, value: result.output as v.InferOutput<S>, valueId: newest.id, duplicates: duplicates.length };
        return issues.length > 0 ? { ...ok, issues } : ok;
    }

    private async save<S extends Schema>(category: 'settings' | 'access', schema: S, next: v.InferOutput<S>, expectedRevision: number): Promise<void> {
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
            merged.machineClients = [...merged.machineClients, ...parseClients(stored.machineClients).rejected];
        }
        const json = JSON.stringify(merged);
        if (json.length > VALUE_LIMIT) throw new ValueTooLargeError(json.length, VALUE_LIMIT);

        // Value first, deletions last: an interruption leaves duplicates, never a lost value.
        if (newest) await this.kv.update(category, newest.id, json);
        else await this.kv.create(category, json);
        for (const d of duplicates) await this.kv.delete(category, d.id);
    }
}
