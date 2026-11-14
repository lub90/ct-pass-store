import type { AxiosAdapter, AxiosInstance } from 'axios';
import { createCtApi, type CtApi } from '@/ct/api';
import { createClient } from '@/ct/client';
import { redactBody } from './redact';
import type { ContractEnv, FixtureUser } from './setup';

/** The cookies of one ChurchTools session (name → value), as a browser profile would hold them. */
export class CookieJar {
    private cookies = new Map<string, string>();

    store(setCookie: readonly string[] | string | undefined): void {
        for (const line of typeof setCookie === 'string' ? [setCookie] : (setCookie ?? [])) {
            const pair = line.split(';', 1)[0]!;
            const eq = pair.indexOf('=');
            if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
    }

    header(): string | null {
        return this.cookies.size === 0 ? null : [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
}

export interface Answer {
    status: number;
    headers: Headers;
    text: string;
    /** The parsed body, `undefined` when it isn't JSON. */
    json: unknown;
}

/** `data` of a ChurchTools answer as a record (empty when it is something else). */
export const dataOf = (a: Answer): Record<string, unknown> => {
    const data = (a.json as { data?: unknown } | undefined)?.data;
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
};
export const listOf = (a: Answer): Record<string, unknown>[] => {
    const data = (a.json as { data?: unknown } | undefined)?.data;
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
};

/**
 * A ChurchTools session for the contract layer's own calls (admin set-up, OAuth): a cookie jar of its own and, when
 * given, a login token sent as `Authorization: Login`. Redirects are never followed. Error messages carry only the
 * method, path, status and a redacted body.
 */
export class CtSession {
    readonly jar = new CookieJar();
    private csrf: string | null = null;

    private readonly env: ContractEnv;
    private readonly loginToken: string | null;

    constructor(env: ContractEnv, loginToken: string | null = null) {
        this.env = env;
        this.loginToken = loginToken;
    }

    async request(method: string, pathOrUrl: string, options: { json?: unknown; form?: Record<string, string>; headers?: Record<string, string>; csrf?: boolean } = {}): Promise<Answer> {
        const url = /^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl) ? pathOrUrl : `${this.env.apiUrl}${pathOrUrl}`;
        if (new URL(url).origin !== this.env.root) throw new Error('CtSession only talks to the test instance');
        const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
        if (this.loginToken) headers.Authorization = `Login ${this.loginToken}`;
        const cookie = this.jar.header();
        if (cookie) headers.Cookie = cookie;
        if (options.csrf) headers['CSRF-Token'] = await this.csrfToken();
        let body: string | undefined;
        if (options.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.json);
        } else if (options.form) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            body = new URLSearchParams(options.form).toString();
        }
        const response = await fetch(url, { method, headers, body, redirect: 'manual' });
        this.jar.store(response.headers.getSetCookie());
        const text = await response.text();
        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch {
            json = undefined;
        }
        return { status: response.status, headers: response.headers, text, json };
    }

    /** Like `request`, but throws unless the status is 2xx. */
    async ok(method: string, path: string, options: Parameters<CtSession['request']>[2] = {}): Promise<Answer> {
        const a = await this.request(method, path, options);
        if (a.status < 200 || a.status >= 300) throw new Error(`${method} ${new URL(path, this.env.root).pathname} answered ${a.status}: ${redactBody(a.text)}`);
        return a;
    }

    async login(user: FixtureUser): Promise<this> {
        const a = await this.request('POST', '/login', { json: { username: user.username, password: user.pwd } });
        if (a.status !== 200 || dataOf(a).status !== 'success') throw new Error(`Login of fixture person ${user.id} answered ${a.status}`);
        this.csrf = null;
        return this;
    }

    async csrfToken(): Promise<string> {
        if (this.csrf === null) {
            const a = await this.request('GET', '/csrftoken');
            const data = (a.json as { data?: unknown } | undefined)?.data;
            if (typeof data !== 'string') throw new Error(`GET /csrftoken answered ${a.status} without a token`);
            this.csrf = data;
        }
        return this.csrf;
    }
}

type Auth = { loginToken: string } | { jar: CookieJar } | null;

interface AxiosLikeError {
    code?: unknown;
    response?: { status?: unknown; headers?: unknown; data?: unknown };
}

function headerValue(headers: unknown, name: string): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    const withGet = headers as { get?: (n: string) => unknown };
    if (typeof withGet.get === 'function') {
        const v = withGet.get(name);
        return typeof v === 'string' ? v : undefined;
    }
    for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name && typeof value === 'string') return value;
    return undefined;
}

/**
 * What of an axios error may leave the test client: an HTTP error keeps `status`, `data` and only the `retry-after`
 * header (all that `mapCtError` reads), a network error only its code. `config` and `request` hold the `Authorization` header with the
 * login token, so they never get into an unhandled rejection or a test report.
 */
export function scrubAxiosError(error: unknown): unknown {
    const e = (error ?? {}) as AxiosLikeError;
    if (e.response && typeof e.response.status === 'number') {
        // Only the header mapCtError reads (retry-after for 429); never set-cookie or anything else.
        const retryAfter = headerValue(e.response.headers, 'retry-after');
        return { response: { status: e.response.status, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter }, data: e.response.data } };
    }
    return new Error(`ChurchTools network error ${typeof e.code === 'string' ? e.code : 'without a code'}`);
}

/**
 * The app's real `CtApi` (`createClient` + `createCtApi`) in Node. Inside ChurchTools the browser carries the session
 * cookie; here a login token (`Authorization: Login`, no cookies at all — as the real-mode dev proxy sends it) or a
 * session's cookie jar stands in for it. `null`: nobody is logged in. `adapter` (unit tests only) replaces the network.
 * `onRequest` sees the headers of every request (to check what was sent).
 */
export function ctApiFor(env: ContractEnv, auth: Auth, adapter?: AxiosAdapter, onRequest?: (headers: Record<string, unknown>) => void): CtApi {
    const client = createClient(env.root);
    // The client's axios instance is private; reaching into it is test-only, to attach the credentials of the run.
    const ax = (client as unknown as { ax: AxiosInstance }).ax;
    if (adapter) ax.defaults.adapter = adapter;
    ax.interceptors.request.use((config) => {
        if (auth && 'loginToken' in auth) config.headers.set('Authorization', `Login ${auth.loginToken}`);
        if (auth && 'jar' in auth) {
            const cookie = auth.jar.header();
            if (cookie) config.headers.set('Cookie', cookie);
        }
        onRequest?.(config.headers.toJSON());
        return config;
    });
    // Registered after the client's own interceptors, so it runs last and nothing sees the raw error afterwards.
    ax.interceptors.response.use(
        (response) => {
            if (auth && 'jar' in auth) auth.jar.store(response.headers['set-cookie'] as string[] | undefined);
            return response;
        },
        (error: { response?: { headers?: Record<string, string[] | undefined> } }) => {
            if (auth && 'jar' in auth) auth.jar.store(error.response?.headers?.['set-cookie']);
            return Promise.reject(scrubAxiosError(error));
        },
    );
    return createCtApi(client, 'ctpassstore');
}
