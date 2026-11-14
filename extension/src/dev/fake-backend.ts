import type { BackendApi, LoginResult, SelfTestResult } from '@/backend/api';
import { BackendProblem } from '@/backend/problems';

/**
 * In-memory backend for tests and the demo. Applies the backend's rules (backend spec 4.1, 4.3 to 4.9, 5.1) in the
 * documented order of checks: token, id, authorization, existence, primary password, custom password, policy.
 * Never imported by production modules.
 */
export interface FakeBackendOptions {
    /** The person the fake acts as once logged in. Default 1. */
    personId?: number;
    admin?: boolean;
    /** Persons that exist in ChurchTools (not archived). Default: only `personId`. */
    existingPersonIds?: number[];
    /** The caller's ChurchTools password. Default `ct-password`. */
    primaryPassword?: string;
    requirePasswordForPasswordChange?: boolean;
    allowCustomPassword?: boolean;
    /** 12 to 64. */
    passwordLength?: number;
    version?: string;
    /** Passwords already stored, by person id. */
    entries?: Record<number, string>;
    /** Start without a token (every call gives `missing-token` until `login`). Default logged in. */
    loggedIn?: boolean;
    /** Login answers `no-service-access`. */
    noServiceAccess?: boolean;
    /** The ChurchTools origin `login` expects in `redirectUri`. Default `https://ct.example`. */
    ctOrigin?: string;
    /** Codes `login` accepts, each once. Default `['valid-code']`. */
    validCodes?: string[];
}

export interface FakeBackendSettings {
    requirePasswordForPasswordChange?: boolean;
    allowCustomPassword?: boolean;
    passwordLength?: number;
}

export interface FakeBackendControls {
    /** The next call fails with this problem (once). */
    failNext(slug: string, status: number, extra?: { retryAfter?: number; violations?: string[]; detail?: string }): void;
    /** The token has expired: calls give `token-expired` until the next `login`. */
    expireToken(): void;
    setSettings(settings: FakeBackendSettings): void;
    /** `GET /v1/entries/{id}` with the id as written in the path: strict decimal, else `invalid-id`. */
    getEntryRaw(id: string): Promise<'set' | 'none'>;
    /** The stored passwords by person id (plaintext, for assertions). */
    readonly entries: ReadonlyMap<number, string>;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@$%&*-_+=?.';
const ALLOWED = LETTERS + DIGITS + SYMBOLS;
const MAX_LENGTH = 128;

/** Backend spec 5.1: the maximum length is checked first and alone. */
function violations(pwd: string, minLength: number): string[] {
    const bytes = new TextEncoder().encode(pwd).length;
    if (bytes > MAX_LENGTH) return ['too-long'];
    const found: string[] = [];
    if (bytes < minLength) found.push('too-short');
    const has = (set: string) => [...pwd].some((c) => set.includes(c));
    if (!has(LETTERS)) found.push('missing-letter');
    if (!has(DIGITS)) found.push('missing-digit');
    if (!has(SYMBOLS)) found.push('missing-symbol');
    if ([...pwd].some((c) => !ALLOWED.includes(c))) found.push('invalid-character');
    return found;
}

const MAX_FIELD = 2048;

/** Backend spec 4.4 step 1: parsed, `https`, and the ChurchTools host and port. */
function redirectAllowed(redirectUri: string, ctOrigin: string): boolean {
    try {
        const url = new URL(redirectUri);
        const ct = new URL(ctOrigin);
        return url.protocol === 'https:' && url.username === '' && url.password === '' && url.host === ct.host;
    } catch {
        return false;
    }
}

function randomInt(max: number): number {
    const buffer = new Uint32Array(1);
    // Rejection sampling keeps the choice uniform.
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    do crypto.getRandomValues(buffer);
    while (buffer[0]! >= limit);
    return buffer[0]! % max;
}

const pick = (set: string) => set[randomInt(set.length)]!;

function generate(length: number): string {
    const chars = [pick(LETTERS), pick(DIGITS), pick(SYMBOLS)];
    while (chars.length < length) chars.push(pick(ALLOWED));
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
}

function problem(slug: string, status: number, extra: { retryAfter?: number; violations?: string[]; detail?: string } = {}): BackendProblem {
    const p = new BackendProblem(slug, status);
    p.detail = extra.detail ?? `Fake backend: ${slug}`;
    if (extra.violations) p.violations = extra.violations;
    if (extra.retryAfter !== undefined) p.retryAfter = extra.retryAfter;
    return p;
}

export function createFakeBackend(options: FakeBackendOptions = {}): BackendApi & FakeBackendControls {
    const me = options.personId ?? 1;
    const admin = options.admin ?? false;
    const existing = new Set(options.existingPersonIds ?? [me]);
    const primaryPassword = options.primaryPassword ?? 'ct-password';
    const settings = {
        requirePasswordForPasswordChange: options.requirePasswordForPasswordChange ?? true,
        allowCustomPassword: options.allowCustomPassword ?? true,
        passwordLength: options.passwordLength ?? 12,
    };
    const version = options.version ?? '1.0.0';
    const store = new Map<number, string>(Object.entries(options.entries ?? {}).map(([id, pwd]) => [Number(id), pwd]));
    const codes = new Set(options.validCodes ?? ['valid-code']);
    let loggedIn = options.loggedIn ?? true;
    let expired = false;
    let failure: BackendProblem | null = null;

    const step = () => {
        if (failure) {
            const f = failure;
            failure = null;
            throw f;
        }
    };
    const authenticate = () => {
        step();
        if (!loggedIn) throw problem('missing-token', 401);
        if (expired) throw problem('token-expired', 401);
    };
    /** Steps 2 to 4 of backend spec 4.1 for `/v1/entries/{id}`. */
    const authorize = (id: number) => {
        authenticate();
        if (!Number.isSafeInteger(id) || id <= 0) throw problem('invalid-id', 400);
        if (id !== me && !admin) throw problem('forbidden', 403);
    };
    const requireExisting = (id: number) => {
        if (id !== me && !existing.has(id)) throw problem('person-not-found', 404);
    };
    const checkPrimary = (primaryPwd: string | undefined) => {
        if (!settings.requirePasswordForPasswordChange) return;
        if (primaryPwd === undefined || primaryPwd === '') throw problem('primary-password-required', 400);
        if (primaryPwd !== primaryPassword) throw problem('invalid-primary-password', 403);
    };

    return {
        get entries() {
            return store;
        },
        failNext(slug, status, extra) {
            failure = problem(slug, status, extra);
        },
        expireToken() {
            expired = true;
        },
        setSettings(s) {
            Object.assign(settings, s);
        },

        async login(code, codeVerifier, redirectUri): Promise<LoginResult> {
            step();
            for (const field of [code, codeVerifier, redirectUri]) {
                if (field === '' || field.length > MAX_FIELD) throw problem('invalid-body', 400);
            }
            if (!redirectAllowed(redirectUri, options.ctOrigin ?? 'https://ct.example')) throw problem('invalid-body', 400);
            if (!codes.delete(code)) throw problem('oauth-code-invalid', 400);
            if (options.noServiceAccess) throw problem('no-service-access', 403);
            loggedIn = true;
            expired = false;
            return { accessToken: 'fake-token', expiresIn: 900, admin, version };
        },

        async getEntry(personId) {
            authorize(personId);
            requireExisting(personId);
            return store.has(personId) ? 'set' : 'none';
        },

        async getEntryRaw(id) {
            authenticate();
            // Strict decimal: no sign, no leading zero, no whitespace, a safe integer.
            if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw problem('invalid-id', 400);
            const personId = Number(id);
            if (personId !== me && !admin) throw problem('forbidden', 403);
            requireExisting(personId);
            return store.has(personId) ? 'set' : 'none';
        },

        async putEntry(personId, body) {
            authorize(personId);
            checkPrimary(body.primaryPwd);
            requireExisting(personId);
            let password: string;
            let generated: string | undefined;
            if (body.secondaryPwd !== undefined) {
                if (!settings.allowCustomPassword) throw problem('custom-password-not-allowed', 400);
                const found = violations(body.secondaryPwd, settings.passwordLength);
                if (found.length > 0) throw problem('password-invalid', 400, { violations: found });
                password = body.secondaryPwd;
            } else {
                password = generated = generate(settings.passwordLength);
            }
            store.set(personId, password);
            return generated === undefined ? {} : { generated };
        },

        async deleteEntry(personId, primaryPwd) {
            authorize(personId);
            checkPrimary(primaryPwd);
            store.delete(personId);
        },

        async selfTest(write = false): Promise<SelfTestResult> {
            authenticate();
            if (!admin) throw problem('forbidden', 403);
            const tests: SelfTestResult['tests'] = [
                { name: 'settings', status: 'ok', message: 'All settings can be read.' },
                { name: 'access', status: 'ok', message: 'The admin group is set.' },
                { name: 'encryption', status: 'ok', message: 'A test encryption succeeded.' },
            ];
            if (write) tests.push({ name: 'write', status: 'ok', message: 'The service user can write a test value.' });
            return { version, summary: `${tests.length} of ${tests.length} checks passed`, tests };
        },
    };
}
