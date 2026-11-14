import * as v from 'valibot';
import { CLIENT_ID_PATTERN, decodeKey, isCalendarDate, phpTrim } from './machine-clients';

/** Layout version of the data this code reads and writes. */
export const SCHEMA_VERSION = 2;

/** Why a `backendUrl` is refused; `null` if it is fine. */
export type BackendUrlProblem = 'not-https' | 'credentials' | 'query' | 'fragment' | 'invalid';

/**
 * `https://` (compared case-sensitively), a host, no credentials (not even empty ones), no query, no fragment, no
 * whitespace, control characters or backslashes — the same as the backend's `parse_url` check (backend spec 3.2).
 * Trailing slashes are not looked at here: the store and the form remove them first.
 */
export function backendUrlProblem(s: string): BackendUrlProblem | null {
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
    if (s === '' || /[\s\u0000-\u001F\u007F\\]/u.test(s)) return 'invalid';
    if (!s.startsWith('https://')) return 'not-https';
    const authority = s.slice('https://'.length).split(/[/?#]/, 1)[0]!;
    if (authority.includes('@')) return 'credentials';
    if (s.includes('?')) return 'query';
    if (s.includes('#')) return 'fragment';
    if (authority === '') return 'invalid';
    try {
        const u = new URL(s);
        return u.protocol === 'https:' && u.hostname !== '' ? null : 'invalid';
    } catch {
        return 'invalid';
    }
}

/**
 * Invisible format characters (`\p{Cf}`: zero-width spaces, soft hyphens, bidi controls): a new or changed
 * `backendUrl` must not contain them (the field and the store's save refuse it), since the address shown would not be
 * the address used. A stored one is still read, like the backend reads it.
 */
export const INVISIBLE = /\p{Cf}/u;

/** The host part (`host[:port]`) as written, between `https://` and the first `/`, `?` or `#`. */
const authorityOf = (s: string): string => s.slice('https://'.length).split(/[/?#]/, 1)[0]!;

/**
 * The host the browser connects to (`URL.host`, lower case, IDN as `xn--`, percent escapes decoded, numbers as an IPv4
 * address), when it differs from the host as written; `null` when they agree (case aside) or the URL doesn't parse.
 * The backend (`parse_url`) keeps the written host, so such an address shows one host and connects to another.
 */
export function connectedHost(s: string): string | null {
    let u: URL;
    try {
        u = new URL(s);
    } catch {
        return null;
    }
    const written = authorityOf(s).toLowerCase();
    return written === u.host || written === `${u.host}:443` ? null : u.host;
}

/**
 * What a new or changed `backendUrl` must not have on top of `backendUrlProblem` (the field and the store's save; a
 * stored one is still read, like the backend reads it): invisible characters, or a host other than the one the
 * browser connects to (non-ASCII or `%` in the host part, or a host the URL parser rewrites).
 */
export function newBackendUrlProblem(s: string): 'invisible' | 'host-encoding' | null {
    if (INVISIBLE.test(s)) return 'invisible';
    if (!/^[\x21-\x7E]*$/.test(authorityOf(s)) || authorityOf(s).includes('%') || connectedHost(s) !== null) return 'host-encoding';
    return null;
}

const isPlainHttpsUrl = (s: string): boolean => backendUrlProblem(s) === null;

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
