/**
 * Errors of the backend layer and the mapping of problem types (spec 8.2) to i18n keys. Callers see these errors
 * (or a programming error such as an invalid person id), never raw responses. No message, log line or property
 * here ever holds a token or a password.
 */

/** An RFC 9457 answer of the backend: `slug` is the fragment of `type`, `status` the HTTP status. */
export class BackendProblem extends Error {
    slug: string;
    status: number;
    /** English, technical; never shown to users, only under „Details“ for admins. */
    detail?: string;
    /** `password-invalid`: the violated rule codes. */
    violations?: string[];
    /** Seconds, for `too-many-attempts`, `upstream-rate-limited` and `cleanup-too-soon`. */
    retryAfter?: number;
    constructor(slug: string, status: number) {
        super(`Backend problem ${slug} (HTTP ${status})`);
        this.name = 'BackendProblem';
        this.slug = slug;
        this.status = status;
    }
}

/** The configured backend address is unusable (not https, has credentials, not a URL). Says nothing about the URL. */
export class BackendConfigError extends Error {
    constructor() {
        super('The backend address must be an https:// URL without credentials');
        this.name = 'BackendConfigError';
    }
}

/** Network failure, CORS failure, timeout or a body that broke off. */
export class BackendUnreachable extends Error {
    constructor() {
        super('The backend could not be reached');
        this.name = 'BackendUnreachable';
    }
}

/** An answer that is not what the contract says: not a problem body, a 200 that isn't JSON, a wrong shape. */
export class UnexpectedResponse extends Error {
    status: number;
    constructor(status: number) {
        super(`Unexpected response from the backend (HTTP ${status})`);
        this.name = 'UnexpectedResponse';
        this.status = status;
    }
}

/** The rule codes of backend spec 5.1; anything else in `violations` is dropped. */
const VIOLATION_CODES = new Set(['too-short', 'too-long', 'missing-letter', 'missing-digit', 'missing-symbol', 'invalid-character']);

/**
 * A problem body as an error, or `null` when it isn't one (no string `type` with a `#slug` of 1 to 64 characters from a-z, 0-9, `-`). The HTTP
 * status is the transport's, not the body's. Odd extension members are dropped rather than trusted.
 */
export function problemFromBody(status: number, body: unknown): BackendProblem | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const record = body as Record<string, unknown>;
    if (typeof record.type !== 'string') return null;
    const hash = record.type.lastIndexOf('#');
    if (hash < 0) return null;
    const slug = record.type.slice(hash + 1);
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;

    const problem = new BackendProblem(slug, status);
    if (typeof record.detail === 'string') problem.detail = record.detail;
    if (Array.isArray(record.violations)) {
        problem.violations = [...new Set(record.violations.filter((v): v is string => typeof v === 'string' && VIOLATION_CODES.has(v)))];
    }
    if (typeof record.retryAfter === 'number' && Number.isInteger(record.retryAfter) && record.retryAfter >= 0) {
        problem.retryAfter = record.retryAfter;
    }
    return problem;
}

const GENERIC = 'problems.generic';
const SESSION = 'problems.session';
const NOT_SET_UP = 'problems.notSetUp';
const UNAVAILABLE = 'problems.upstreamUnavailable';
const RATE_LIMITED = 'problems.rateLimited';

/**
 * Every slug the backend documents (`backend/docs/problems.md`, plus the setup ones) and its i18n key. A guard test
 * fails for a documented slug that is missing here. Unknown slugs fall back to `problems.generic`.
 */
export const PROBLEM_KEYS: Readonly<Record<string, string>> = {
    'entry-not-found': 'problems.entryNotFound',
    'primary-password-required': 'problems.primaryPasswordRequired',
    'invalid-primary-password': 'problems.invalidPrimaryPassword',
    'password-invalid': 'problems.passwordInvalid',
    'custom-password-not-allowed': 'problems.customPasswordNotAllowed',
    'too-many-attempts': RATE_LIMITED,
    'upstream-rate-limited': RATE_LIMITED,
    // Handled by the session logic (7.2); the text is only a fallback.
    'token-expired': SESSION,
    'missing-token': SESSION,
    'invalid-token': SESSION,
    'no-service-access': 'problems.noServiceAccess',
    forbidden: 'problems.forbidden',
    'person-not-found': 'problems.personNotFound',
    'oauth-code-invalid': 'problems.loginFailed',
    'upstream-unavailable': UNAVAILABLE,
    'upstream-invalid': UNAVAILABLE,
    misconfigured: NOT_SET_UP,
    'not-configured': NOT_SET_UP,
    'internal-error': GENERIC,
    // Programming errors: the request was malformed or aimed at the wrong place.
    'invalid-id': GENERIC,
    'invalid-body': GENERIC,
    'not-found': GENERIC,
    'https-required': GENERIC,
    'method-not-allowed': GENERIC,
    'payload-too-large': GENERIC,
    'unsupported-media-type': GENERIC,
    // Endpoints the extension does not call.
    'cleanup-running': GENERIC,
    'cleanup-too-soon': GENERIC,
    'already-configured': GENERIC,
    'setup-check-failed': GENERIC,
};

const PROGRAMMING_ERRORS = new Set(['invalid-id', 'invalid-body', 'not-found', 'https-required', 'method-not-allowed', 'payload-too-large', 'unsupported-media-type']);

/** Problems that mean the extension sent something wrong; the caller logs them to the console (spec 8.2). */
export function isProgrammingError(error: unknown): boolean {
    return error instanceof BackendProblem && PROGRAMMING_ERRORS.has(error.slug);
}

/**
 * The i18n key under `problems.*` for an error. Texts with `{n}` (minutes, from `retryAfter`) or `{status}` get
 * their parameter from the caller. The technical `detail` is never part of any text.
 */
export function problemMessageKey(error: unknown): string {
    if (error instanceof BackendProblem) return Object.hasOwn(PROBLEM_KEYS, error.slug) ? PROBLEM_KEYS[error.slug]! : GENERIC;
    if (error instanceof BackendUnreachable) return 'problems.unreachable';
    if (error instanceof UnexpectedResponse) return 'problems.unexpected';
    return GENERIC;
}

/** Minutes to show for a `retryAfter` in seconds: rounded up, at least 1 and at most 60 (a wild value stays readable). */
export function retryMinutes(seconds: number | undefined): number {
    return Math.min(60, Math.max(1, Math.ceil((seconds ?? 0) / 60)));
}

const RATE_LIMIT_SLUGS = new Set(['too-many-attempts', 'upstream-rate-limited']);

/** The parameters of the text of `problemMessageKey(error)`: `{status}` (a dash without HTTP status) and `{n}` minutes. */
export function problemParams(error: unknown): { status: number | string; n?: number } {
    if (error instanceof BackendProblem) {
        return RATE_LIMIT_SLUGS.has(error.slug) ? { status: error.status, n: retryMinutes(error.retryAfter) } : { status: error.status };
    }
    if (error instanceof UnexpectedResponse) return { status: error.status };
    return { status: '–' };
}
