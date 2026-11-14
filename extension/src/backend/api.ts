import { createHttp, backendBase, TIMEOUT_MS } from './http';
import { BackendConfigError, BackendProblem, UnexpectedResponse } from './problems';

export { backendBase, TIMEOUT_MS };

export interface LoginResult {
    accessToken: string;
    expiresIn: number;
    admin: boolean;
    version: string;
}

export interface SelfTestResult {
    version: string;
    summary: string;
    tests: { name: string; status: 'ok' | 'fail'; message: string }[];
}

/** Everything the app asks of the backend (backend spec 4.4 to 4.8). Rejects as documented in `problems.ts`. */
export interface BackendApi {
    /** Exchanges the OAuth code for a backend token. Sends no `Authorization` header. */
    login(code: string, codeVerifier: string, redirectUri: string): Promise<LoginResult>;
    /** Whether the person has an entry. Only `entry-not-found` is "none"; any other problem rejects. */
    getEntry(personId: number): Promise<'set' | 'none'>;
    /** `generated` holds the new plaintext password when none was given (the only time it is ever sent). */
    putEntry(personId: number, body: { primaryPwd?: string; secondaryPwd?: string }): Promise<{ generated?: string }>;
    /** Idempotent. */
    deleteEntry(personId: number, primaryPwd?: string): Promise<void>;
    /** Admins only. `write` also tries a test write. */
    selfTest(write?: boolean): Promise<SelfTestResult>;
}

/** A person id that would end up in a path isn't a positive safe integer. Thrown before any request. */
export class InvalidPersonIdError extends Error {
    constructor() {
        super('Invalid person id');
        this.name = 'InvalidPersonIdError';
    }
}

function personPath(personId: number): string {
    if (typeof personId !== 'number' || !Number.isSafeInteger(personId) || personId <= 0) throw new InvalidPersonIdError();
    return `/entries/${personId}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface BackendApiOptions {
    /** Development only: also allow `http://localhost` and `http://127.0.0.1`. */
    allowLocalHttp?: boolean;
}

/** Throws `BackendConfigError` unless the address is `https:` without credentials (or local http, if allowed). */
function checkBaseUrl(baseUrl: string, allowLocalHttp: boolean): void {
    let url: URL;
    try {
        url = new URL(baseUrl.trim());
    } catch {
        throw new BackendConfigError();
    }
    if (url.username !== '' || url.password !== '') throw new BackendConfigError();
    if (url.protocol === 'https:') return;
    if (allowLocalHttp && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return;
    throw new BackendConfigError();
}

export function createBackendApi(baseUrl: string, token: () => string | null, options: BackendApiOptions = {}): BackendApi {
    checkBaseUrl(baseUrl, options.allowLocalHttp === true);
    const request = createHttp(backendBase(baseUrl), token);

    return {
        async login(code, codeVerifier, redirectUri) {
            const { status, body } = await request('POST', '/auth/token', { body: { code, codeVerifier, redirectUri }, auth: false });
            if (
                status !== 200 ||
                !isObject(body) ||
                typeof body.accessToken !== 'string' ||
                body.accessToken === '' ||
                body.tokenType !== 'Bearer' ||
                typeof body.expiresIn !== 'number' ||
                !Number.isInteger(body.expiresIn) ||
                body.expiresIn < 1 ||
                body.expiresIn > 86_400 ||
                typeof body.admin !== 'boolean' ||
                typeof body.version !== 'string' ||
                body.version === ''
            ) {
                throw new UnexpectedResponse(status);
            }
            return { accessToken: body.accessToken, expiresIn: body.expiresIn, admin: body.admin, version: body.version };
        },

        async getEntry(personId) {
            const path = personPath(personId);
            try {
                const { status, body } = await request('GET', path);
                // The ciphertext is not needed here; only that it is there.
                if (status !== 200 || !isObject(body) || typeof body.secondaryPwd !== 'string') throw new UnexpectedResponse(status);
                return 'set';
            } catch (error) {
                if (error instanceof BackendProblem && error.slug === 'entry-not-found' && error.status === 404) return 'none';
                throw error;
            }
        },

        async putEntry(personId, fields) {
            const path = personPath(personId);
            const payload: { primaryPwd?: string; secondaryPwd?: string } = {};
            if (fields.primaryPwd !== undefined) payload.primaryPwd = fields.primaryPwd;
            if (fields.secondaryPwd !== undefined) payload.secondaryPwd = fields.secondaryPwd;
            const { status, body } = await request('PUT', path, { body: payload });
            // A custom password is acknowledged with 204 only; a generated one comes back with 200 only.
            if (fields.secondaryPwd !== undefined) {
                if (status === 204) return {};
            } else if (status === 200 && isObject(body) && typeof body.secondaryPwd === 'string' && body.secondaryPwd !== '') {
                return { generated: body.secondaryPwd };
            }
            throw new UnexpectedResponse(status);
        },

        async deleteEntry(personId, primaryPwd) {
            const path = personPath(personId);
            const { status } = await request('DELETE', path, primaryPwd === undefined ? {} : { body: { primaryPwd } });
            if (status !== 204) throw new UnexpectedResponse(status);
        },

        async selfTest(write = false) {
            const { status, body } = await request('GET', write ? '/test?write=1' : '/test');
            if (
                (status !== 200 && status !== 207) ||
                !isObject(body) ||
                typeof body.version !== 'string' ||
                body.version === '' ||
                typeof body.summary !== 'string' ||
                !Array.isArray(body.tests) ||
                !body.tests.every(
                    (t: unknown) =>
                        isObject(t) && typeof t.name === 'string' && (t.status === 'ok' || t.status === 'fail') && typeof t.message === 'string',
                )
            ) {
                throw new UnexpectedResponse(status);
            }
            return {
                version: body.version,
                summary: body.summary,
                tests: body.tests.map((t: { name: string; status: 'ok' | 'fail'; message: string }) => ({ name: t.name, status: t.status, message: t.message })),
            };
        },
    };
}
