import * as v from 'valibot';
import { CLIENT_ID_PATTERN, decodeKey, isCalendarDate, phpTrim } from './machine-clients';

/** Layout version of the data this code reads and writes. */
export const SCHEMA_VERSION = 2;

/** `https://`, no credentials, no query, no fragment (mirrors backend spec 3.2). */
function isPlainHttpsUrl(s: string): boolean {
    // Scheme compared case-sensitively and no whitespace, like the backend's parse_url based check.
    if (!/^https:\/\/\S+$/.test(s)) return false;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' && u.username === '' && u.password === '' && u.search === '' && u.hash === '' && !s.includes('?') && !s.includes('#');
    } catch {
        return false;
    }
}

/** Bidi embedding/override (U+202A–U+202E) and isolate (U+2066–U+2069) controls: they can make a text read differently. */
export const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/u;
const noBidi = v.check((s: string) => !BIDI_CONTROLS.test(s), 'must not contain bidi control characters');

const PageText = v.looseObject({
    title: v.optional(v.pipe(v.string(), v.maxLength(60), noBidi)),
    intro: v.optional(v.pipe(v.string(), v.maxLength(300), noBidi)),
});

export const SettingsTextsSchema = v.pipe(
    v.unknown(),
    v.check((texts) => !Array.isArray(texts), 'must be an object'),
    v.looseObject({ de: v.optional(PageText), en: v.optional(PageText) }),
);
export type SettingsTexts = v.InferOutput<typeof SettingsTextsSchema>;

/** The highest revision a value may hold: one more still is a safe integer, so a raise never rounds. */
export const MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;
/** A revision a save can compare and raise exactly. */
export const isUsableRevision = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= MAX_REVISION;

const Revision = v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(MAX_REVISION));

/** `passwordLength` bounds (backend spec 3.2, Q7). */
export const PASSWORD_LENGTH = { min: 12, max: 64 } as const;

/** Unknown fields are allowed (and kept) by `looseObject`. */
export const SettingsSchema = v.looseObject({
    schema: v.literal(SCHEMA_VERSION),
    revision: Revision,
    requirePasswordForPasswordChange: v.boolean(),
    allowCustomPassword: v.boolean(),
    passwordLength: v.pipe(v.number(), v.integer(), v.minValue(PASSWORD_LENGTH.min), v.maxValue(PASSWORD_LENGTH.max)),
    backendUrl: v.optional(v.pipe(v.string(), v.check(isPlainHttpsUrl, 'must be an https:// URL without credentials, query or fragment'))),
    oauthClientId: v.optional(v.pipe(v.string(), v.minLength(1))),
    texts: v.optional(SettingsTextsSchema),
});
export type SettingsV2 = v.InferOutput<typeof SettingsSchema>;

/** Strict (write) shape of a machine client; the rules are the backend's (see `machine-clients.ts`). */
export const MachineClientSchema = v.looseObject({
    id: v.pipe(v.string(), v.regex(CLIENT_ID_PATTERN)),
    name: v.pipe(v.string(), v.check((n) => phpTrim(n) !== '', 'name must not be empty')),
    publicKeys: v.pipe(v.array(v.pipe(v.string(), v.check((k) => phpTrim(k) === k && decodeKey(k) !== null, 'must be a canonical base64 or base64url Ed25519 key without surrounding whitespace'))), v.minLength(1)),
    permissions: v.array(v.picklist(['entries:read'])),
    createdAt: v.pipe(v.string(), v.check((d: string) => isCalendarDate(d), 'must be a date like 2026-11-01')),
});
export type MachineClient = v.InferOutput<typeof MachineClientSchema>;

const GroupRef = v.looseObject({ groupId: v.pipe(v.number(), v.safeInteger(), v.minValue(1)), createdBySetup: v.boolean() });

/** Keys the old (v1) layout had in a category; they are never read into a value and never written back. */
export const RETIRED_KEYS: Record<'settings' | 'access', readonly string[]> = {
    settings: ['adminUsers', 'readAccessUsers', 'machineClients'],
    access: [],
};

/** Indices of clients the backend disables: those with a duplicate id or a public key shared with another client. */
export function conflictingClients(clients: readonly MachineClient[]): Set<number> {
    const result = new Set<number>();
    const ids = new Map<string, number[]>();
    const keys = new Map<string, number[]>();
    clients.forEach((c, i) => {
        ids.set(c.id, [...(ids.get(c.id) ?? []), i]);
        for (const k of new Set(c.publicKeys.map(decodeKey))) if (k !== null) keys.set(k, [...(keys.get(k) ?? []), i]);
    });
    for (const group of [...ids.values(), ...keys.values()]) if (group.length > 1) group.forEach((i) => result.add(i));
    return result;
}

export const AccessSchema = v.looseObject({
    schema: v.literal(SCHEMA_VERSION),
    revision: Revision,
    groups: v.looseObject({ users: GroupRef, admins: GroupRef, service: GroupRef }),
    machineClients: v.pipe(
        v.array(MachineClientSchema),
        v.check((clients) => conflictingClients(clients).size === 0, 'client ids must be unique and a public key must belong to one client only'),
    ),
});
export type AccessV2 = v.InferOutput<typeof AccessSchema>;
