import * as v from 'valibot';
import { InvalidValueError, ConflictError, ValueTooLargeError } from '@/model/errors';
import { AccessSchema, SCHEMA_VERSION, SettingsSchema, type AccessV2, type SettingsV2 } from '@/model/schemas';
import type { KvBackend } from './kv';

export const VALUE_LIMIT = 10_000;

export type Read<T> =
    | { state: 'missing' }
    | { state: 'invalid'; issues: string[] }
    | { state: 'newer'; schema: number }
    | { state: 'ok'; value: T; valueId: number; duplicates: number };

type Schema = typeof SettingsSchema | typeof AccessSchema;

const issuesOf = (issues: v.BaseIssue<unknown>[]): string[] =>
    issues.map((i) => `${i.path?.map((p) => String(p.key)).join('.') || '(value)'}: ${i.message}`);

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

    /** Highest value ID first; unparsable JSON counts as invalid. */
    private async load(category: string) {
        const values = (await this.kv.values(category)).sort((a, b) => b.id - a.id);
        return { newest: values[0], duplicates: values.slice(1) };
    }

    private async read<S extends Schema>(category: string, schema: S): Promise<Read<v.InferOutput<S>>> {
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
        const result = v.safeParse(schema, raw);
        if (!result.success) return { state: 'invalid', issues: issuesOf(result.issues) };
        return { state: 'ok', value: result.output as v.InferOutput<S>, valueId: newest.id, duplicates: duplicates.length };
    }

    private async save<S extends Schema>(category: string, schema: S, next: v.InferOutput<S>, expectedRevision: number): Promise<void> {
        // Strict: validate what the caller hands in, before touching the store.
        const checked = v.safeParse(schema, next);
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
                    if (typeof revision === 'number') currentRevision = revision;
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

        const json = JSON.stringify({ ...stored, ...checked.output, revision: expectedRevision + 1 });
        if (json.length > VALUE_LIMIT) throw new ValueTooLargeError(json.length, VALUE_LIMIT);

        // Value first, deletions last: an interruption leaves duplicates, never a lost value.
        if (newest) await this.kv.update(category, newest.id, json);
        else await this.kv.create(category, json);
        for (const d of duplicates) await this.kv.delete(category, d.id);
    }
}
