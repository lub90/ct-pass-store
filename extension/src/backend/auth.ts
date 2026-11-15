/**
 * OAuth login against ChurchTools with PKCE and the backend token (spec 7.1, 7.2, E7, E8; backend plan 5.1).
 *
 * - Page login: `state`, verifier, return path and backend address go to `sessionStorage['cps-login']`, then the page
 *   goes to `/oauth/authorize`. The callback route reads and removes them (always, success or not), checks `state`
 *   exactly and exchanges the code at the backend.
 * - Popup login (renewal during a session): state and verifier stay in this object's memory; the callback page in the
 *   popup posts `{code, state}` to its opener with its own origin as target, and only a message from that popup, from
 *   our own origin, with the expected state is taken.
 * - The token lives in memory and in `sessionStorage['cps-token']`, bound to the backend it was issued for and to the
 *   ChurchTools person (`sub`). The app calls `configure()` with the settings and `bindPerson()` with whoami's id at
 *   startup (`useAppState`), before it decides on a page login; until both are done no token is handed out.
 *
 * Code, verifier, state and token never go into an error, a log line or a URL other than the authorize URL.
 */
import type { InjectionKey } from 'vue';
import { BASE_PATH, CALLBACK_PATH } from '../config';
import { instanceBaseUrl } from '../ct/client';
import type { BackendApi, LoginResult } from './api';
import { backendBase } from './http';
import { tokenPerson } from './jwt';
import { authorizeUrl, createPkce, randomToken } from './pkce';
import { UnexpectedResponse } from './problems';

export const LOGIN_KEY = 'cps-login';
export const TOKEN_KEY = 'cps-token';
/** Epoch ms of the last completed page login (loop guard, `recentPageLogin`). */
export const LAST_LOGIN_KEY = 'cps-login-done';
/** Epoch ms of the last retried page login after `oauth-code-invalid` (spec 8.2, `claimLoginRetry`). */
export const LOGIN_RETRY_KEY = 'cps-login-retry';
/** A token problem this soon after a page login doesn't start another one. */
const LOGIN_LOOP_MS = 60_000;
/** `type` of the message the callback popup posts to its opener. */
export const POPUP_MESSAGE = 'cps-oauth-callback';
/** Popup logins use states with this prefix, so the callback page knows to hand over instead of exchanging. */
const POPUP_STATE_PREFIX = 'p.';
const POPUP_STATE = /^p\.[A-Za-z0-9_-]{43}$/;
const POPUP_NAME = 'cps-login';
const POPUP_FEATURES = 'popup,width=520,height=680';
const POLL_MS = 500;
/** A popup login that hasn't handed over a code by then is given up. */
const POPUP_TIMEOUT_MS = 5 * 60_000;
const MAX_CODE_LENGTH = 4096;
const MAX_RETURN_PATH_LENGTH = 2048;

/** The browser blocked the login popup. */
export class PopupBlocked extends Error {
    constructor() {
        super('The login popup was blocked');
        this.name = 'PopupBlocked';
    }
}

/** The login popup was closed before it handed over a code. */
export class PopupClosed extends Error {
    constructor() {
        super('The login popup was closed');
        this.name = 'PopupClosed';
    }
}

/** A callback without matching stored login data, with a wrong or missing `state`, or without a usable code. */
export class LoginStateError extends Error {
    constructor() {
        super('The login callback does not match a started login');
        this.name = 'LoginStateError';
    }
}

/** The new token belongs to another person than the one logged into ChurchTools now. It was not stored. */
export class PersonMismatch extends Error {
    constructor() {
        super('The login belongs to another person');
        this.name = 'PersonMismatch';
    }
}

/** A login can't start: no configuration yet, or `sessionStorage` can't hold the login data. */
export class LoginUnavailable extends Error {
    constructor() {
        super('A login cannot be started here');
        this.name = 'LoginUnavailable';
    }
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface PopupLike {
    readonly closed: boolean;
    close(): void;
    location: { replace(url: string): void };
}

export interface MessageLike {
    origin: string;
    source: unknown;
    data: unknown;
}

/** What `Auth` needs of the browser; `windowEnv()` is the real one, tests pass fakes. */
export interface AuthEnv {
    /** Origin of this page; the callback runs here, so messages must come from here. */
    origin: string;
    /** ChurchTools base URL; its origin serves `/oauth/authorize`. */
    instanceBaseUrl: string;
    /** Path of the callback route, from the origin (`/ccm/ctpassstore/auth/callback`). */
    redirectPath: string;
    /** `sessionStorage`; may throw or be missing. */
    storage(): StorageLike | null;
    assign(url: string): void;
    open(url: string, name: string, features: string): PopupLike | null;
    /** Adds a `message` listener and returns its removal. */
    listen(handler: (event: MessageLike) => void): () => void;
    /** Runs `fn` every `ms` and returns its stop. */
    every(ms: number, fn: () => void): () => void;
    now(): number;
}

export function windowEnv(): AuthEnv {
    return {
        origin: window.location.origin,
        instanceBaseUrl: instanceBaseUrl(),
        redirectPath: `${BASE_PATH}${CALLBACK_PATH}`,
        storage: () => window.sessionStorage,
        assign: (url) => window.location.assign(url),
        open: (url, name, features) => window.open(url, name, features),
        listen: (handler) => {
            const listener = (event: MessageEvent) => handler(event);
            window.addEventListener('message', listener);
            return () => window.removeEventListener('message', listener);
        },
        every: (ms, fn) => {
            const id = window.setInterval(fn, ms);
            return () => window.clearInterval(id);
        },
        now: () => Date.now(),
    };
}

export interface AuthConfig {
    /** `settings.backendUrl`. */
    backendUrl: string;
    /** `settings.oauthClientId`. */
    clientId: string;
}

interface TokenRecord {
    accessToken: string;
    /** Epoch milliseconds. */
    expiresAt: number;
    admin: boolean;
    version: string;
    /** `backendBase()` of the backend that issued it. */
    backend: string;
    /** ChurchTools person id from the token's `sub`. */
    person: number;
}

interface LoginRecord {
    state: string;
    verifier: string;
    returnPath: string;
    backendUrl: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';
const usableCode = (v: unknown): v is string => nonEmpty(v) && v.length <= MAX_CODE_LENGTH;
const personId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Whether a router path is the callback route, matched like vue-router does: case-insensitive, trailing slash optional. */
export function isCallbackPath(path: string): boolean {
    return path.toLowerCase().replace(/\/+$/, '') === `/${CALLBACK_PATH}`.toLowerCase();
}

/**
 * A path of this app (router path, below `BASE_PATH`) to return to after the login, or `/`. Accepts printable ASCII
 * only (router `fullPath`s are percent-encoded), so no whitespace, control, format or look-alike characters. Refuses
 * absolute and protocol-relative URLs, backslashes, percent-encoded slashes and backslashes, broken encoding, overlong
 * paths, and the callback route itself, matched like vue-router does: case-insensitive, trailing slash optional.
 */
export function safeReturnPath(path: unknown): string {
    if (typeof path !== 'string' || path.length > MAX_RETURN_PATH_LENGTH) return '/';
    if (!/^\/(?!\/)[\x21-\x5b\x5d-\x7e]*$/.test(path)) return '/';
    if (/%(2f|5c)/i.test(path)) return '/';
    let pathname: string;
    try {
        pathname = decodeURIComponent(path.split(/[?#]/)[0]!);
    } catch {
        return '/';
    }
    if (isCallbackPath(pathname)) return '/';
    return path;
}

function single(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

export class Auth {
    private config: AuthConfig | null = null;
    private person: number | null = null;
    private current: TokenRecord | null;
    private readonly listeners = new Set<() => void>();
    private readonly backend: (baseUrl: string) => Pick<BackendApi, 'login'>;
    private readonly env: AuthEnv;

    /** `backend` makes the API for a backend address; `env` is the browser (fakes in tests). */
    constructor(backend: (baseUrl: string) => Pick<BackendApi, 'login'>, env: AuthEnv = windowEnv()) {
        this.backend = backend;
        this.env = env;
        this.current = this.loadToken();
    }

    /** Called once the settings are known; a changed backend makes the stored token unusable. */
    configure(config: AuthConfig): void {
        this.config = { backendUrl: config.backendUrl, clientId: config.clientId };
        this.notify();
    }

    /**
     * The ChurchTools person logged in now (whoami). A token of another person is dropped; an invalid id drops the
     * token too. Called at startup before deciding on a page login.
     */
    bindPerson(id: number): void {
        this.person = personId(id) ? id : null;
        if (this.person === null) this.clear();
        this.notify();
    }

    /** Backend and person the token must belong to; changes when either does. `null` before `configure()`. */
    scope(): string | null {
        return this.config ? `${backendBase(this.config.backendUrl)}#${this.person ?? ''}` : null;
    }

    /** Whether a page login completed less than 60 s ago (in this tab). Guards against a login loop. */
    recentPageLogin(): boolean {
        const raw = this.read(LAST_LOGIN_KEY);
        if (raw === null || !/^\d+$/.test(raw)) return false;
        const age = this.env.now() - Number(raw);
        return age >= 0 && age < LOGIN_LOOP_MS;
    }

    /**
     * Spec 8.2: after `oauth-code-invalid` the login is retried once. True (and remembered for 60 s in this tab) if no
     * retry happened in the last 60 s; false otherwise, and always false when the marker can't be stored, so a broken
     * storage can't cause a loop. A completed page login clears it.
     */
    claimLoginRetry(): boolean {
        const raw = this.read(LOGIN_RETRY_KEY);
        if (raw !== null && /^\d+$/.test(raw)) {
            const age = this.env.now() - Number(raw);
            if (age < LOGIN_LOOP_MS) return false;
        }
        const stamp = String(this.env.now());
        return this.write(LOGIN_RETRY_KEY, stamp) && this.read(LOGIN_RETRY_KEY) === stamp;
    }

    /** Called after `configure()`, `bindPerson()` and every new token (not on `clear()`); returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of [...this.listeners]) listener();
    }

    /** The bearer token for the configured backend and bound person, or `null`. Expiry is the backend's call (`token-expired`). */
    token(): string | null {
        return this.bound()?.accessToken ?? null;
    }

    /**
     * The token for a request to `baseUrl`: only if that is the configured backend (compared as `backendBase()`), so a
     * client built for another address never carries it.
     */
    tokenFor(baseUrl: string): string | null {
        if (!this.config || backendBase(baseUrl) !== backendBase(this.config.backendUrl)) return null;
        return this.token();
    }

    /** Role and backend version from the login answer behind the current token. */
    info(): { admin: boolean; version: string } | null {
        const t = this.bound();
        return t ? { admin: t.admin, version: t.version } : null;
    }

    /** Milliseconds until the token expires; `0` without a token or after expiry. */
    expiresInMs(): number {
        const t = this.bound();
        return t ? Math.max(0, t.expiresAt - this.env.now()) : 0;
    }

    clear(): void {
        this.current = null;
        this.remove(TOKEN_KEY);
    }

    /** Full-page login (spec 7.1 step 1). Never settles: the page leaves. Rejects `LoginUnavailable` instead of looping. */
    async startPageLogin(returnPath: string): Promise<never> {
        const config = this.requireConfig();
        const { verifier, challenge } = await createPkce();
        const state = randomToken();
        const record: LoginRecord = { state, verifier, returnPath: safeReturnPath(returnPath), backendUrl: config.backendUrl };
        // Read back: a storage that drops writes silently would otherwise lead to an endless login loop.
        if (!this.write(LOGIN_KEY, JSON.stringify(record)) || this.read(LOGIN_KEY) === null) throw new LoginUnavailable();
        this.env.assign(authorizeUrl(this.env.instanceBaseUrl, config.clientId, this.redirectUri(), state, challenge));
        return new Promise<never>(() => undefined);
    }

    /**
     * The callback route as a page (spec 7.1 step 2). Returns the safe return path. The stored login data is removed
     * first, so it is used at most once whatever happens.
     */
    async completePageLogin(query: Record<string, unknown>): Promise<string> {
        // Without the settings there is no backend to compare with: the code is not exchanged.
        const config = this.requireConfig();
        const raw = this.read(LOGIN_KEY);
        this.remove(LOGIN_KEY);
        // Fails closed: login data that can't be removed could be used again.
        if (raw !== null && this.read(LOGIN_KEY) !== null) throw new LoginStateError();
        const login = parseLogin(raw);
        const state = single(query.state);
        const code = query.code;
        if (!login || state === null || state !== login.state || !usableCode(code)) throw new LoginStateError();
        // The code goes only to the backend the settings name now, not to one remembered from an older login.
        if (backendBase(login.backendUrl) !== backendBase(config.backendUrl)) throw new LoginStateError();
        const result = await this.backend(login.backendUrl).login(code, login.verifier, this.redirectUri());
        this.storeToken(result, login.backendUrl);
        this.write(LAST_LOGIN_KEY, String(this.env.now()));
        this.remove(LOGIN_RETRY_KEY);
        return login.returnPath;
    }

    /**
     * Renewal through a popup (spec 7.2). Must be called inside a click handler: the popup is opened synchronously.
     * Rejects `PopupBlocked`, `PopupClosed` (also after 5 minutes without a code), `LoginUnavailable`,
     * `PersonMismatch` (someone else is logged into ChurchTools now; the old token is dropped) or the backend's error. Must not run twice at once (both would share the popup window name); `useSession` makes overlapping
     * renewals share one call.
     */
    loginInPopup(): Promise<void> {
        let config: AuthConfig;
        try {
            config = this.requireConfig();
        } catch (error) {
            return Promise.reject(error);
        }
        let popup: PopupLike | null;
        try {
            popup = this.env.open('about:blank', POPUP_NAME, POPUP_FEATURES);
        } catch {
            popup = null;
        }
        if (!popup) return Promise.reject(new PopupBlocked());
        return this.runPopup(popup, config);
    }

    private async runPopup(popup: PopupLike, config: AuthConfig): Promise<void> {
        let verifier: string;
        let state: string;
        try {
            const pkce = await createPkce();
            verifier = pkce.verifier;
            state = POPUP_STATE_PREFIX + randomToken();
            popup.location.replace(authorizeUrl(this.env.instanceBaseUrl, config.clientId, this.redirectUri(), state, pkce.challenge));
        } catch (error) {
            closeQuietly(popup);
            throw error;
        }

        const code = await new Promise<string>((resolve, reject) => {
            let closedSeen = false;
            const stop = (): void => {
                unlisten();
                stopPolling();
            };
            const unlisten = this.env.listen((event) => {
                if (event.source !== popup || event.origin !== this.env.origin) return;
                const data = event.data;
                if (!isObject(data) || data.type !== POPUP_MESSAGE || data.state !== state || !usableCode(data.code)) return;
                stop();
                resolve(data.code);
            });
            // The callback closes itself right after posting; one more check gives its message time to arrive.
            const deadline = this.env.now() + POPUP_TIMEOUT_MS;
            const stopPolling = this.env.every(POLL_MS, () => {
                if (this.env.now() >= deadline) {
                    stop();
                    closeQuietly(popup);
                    reject(new PopupClosed());
                    return;
                }
                if (!isClosed(popup)) return;
                if (!closedSeen) {
                    closedSeen = true;
                    return;
                }
                stop();
                reject(new PopupClosed());
            });
        });

        const result = await this.backend(config.backendUrl).login(code, verifier, this.redirectUri());
        this.storeToken(result, config.backendUrl);
    }

    private redirectUri(): string {
        return `${this.env.origin}${this.env.redirectPath}`;
    }

    private requireConfig(): AuthConfig {
        if (!this.config) throw new LoginUnavailable();
        return this.config;
    }

    /** The token if it belongs to the configured backend and bound person; a token of another one is dropped. */
    private bound(): TokenRecord | null {
        if (!this.current || !this.config || this.person === null) return null;
        if (this.current.backend !== backendBase(this.config.backendUrl) || this.current.person !== this.person) {
            this.clear();
            return null;
        }
        return this.current;
    }

    /** Rejects a token without a usable `sub` (`UnexpectedResponse`) or for another person (`PersonMismatch`). */
    private storeToken(result: LoginResult, backendUrl: string): void {
        const person = tokenPerson(result.accessToken);
        if (person === null) throw new UnexpectedResponse(200);
        if (this.person !== null && person !== this.person) {
            this.clear();
            throw new PersonMismatch();
        }
        this.current = {
            accessToken: result.accessToken,
            expiresAt: this.env.now() + result.expiresIn * 1000,
            admin: result.admin,
            version: result.version,
            backend: backendBase(backendUrl),
            person,
        };
        // Without sessionStorage the token stays in memory only (a reload logs in again).
        this.write(TOKEN_KEY, JSON.stringify(this.current));
        this.notify();
    }

    private loadToken(): TokenRecord | null {
        const raw = this.read(TOKEN_KEY);
        if (raw === null) return null;
        const record = parseToken(raw);
        if (!record) this.remove(TOKEN_KEY);
        return record;
    }

    private read(key: string): string | null {
        try {
            return this.env.storage()?.getItem(key) ?? null;
        } catch {
            return null;
        }
    }

    private write(key: string, value: string): boolean {
        try {
            const storage = this.env.storage();
            if (!storage) return false;
            storage.setItem(key, value);
            return true;
        } catch {
            return false;
        }
    }

    private remove(key: string): void {
        try {
            this.env.storage()?.removeItem(key);
        } catch {
            // Nothing to remove from a storage that can't be used.
        }
    }
}

function parseJson(raw: string | null): unknown {
    if (raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function parseLogin(raw: string | null): LoginRecord | null {
    const v = parseJson(raw);
    if (!isObject(v) || !nonEmpty(v.state) || !nonEmpty(v.verifier) || !nonEmpty(v.backendUrl)) return null;
    return { state: v.state, verifier: v.verifier, returnPath: safeReturnPath(v.returnPath), backendUrl: v.backendUrl };
}

function parseToken(raw: string): TokenRecord | null {
    const v = parseJson(raw);
    if (
        !isObject(v) ||
        !nonEmpty(v.accessToken) ||
        typeof v.expiresAt !== 'number' ||
        !Number.isFinite(v.expiresAt) ||
        typeof v.admin !== 'boolean' ||
        typeof v.version !== 'string' ||
        !nonEmpty(v.backend) ||
        !personId(v.person)
    ) {
        return null;
    }
    return { accessToken: v.accessToken, expiresAt: v.expiresAt, admin: v.admin, version: v.version, backend: v.backend, person: v.person };
}

function isClosed(popup: PopupLike): boolean {
    try {
        return popup.closed;
    } catch {
        return false;
    }
}

function closeQuietly(popup: PopupLike): void {
    try {
        popup.close();
    } catch {
        // Already gone.
    }
}

export interface CallbackWindow {
    opener: { postMessage(message: unknown, targetOrigin: string): void } | null;
    origin: string;
    close(): void;
}

/**
 * The callback route's first step (spec 7.1 step 3). A popup login (state with the popup prefix) hands `{code, state}`
 * to the opener, with this page's origin as the only allowed target, and closes. Returns `'page'` for a page login,
 * `'invalid'` for a malformed popup state (nothing posted).
 */
export function forwardPopupCallback(query: Record<string, unknown>, win: CallbackWindow): 'page' | 'forwarded' | 'closed' | 'no-opener' | 'invalid' {
    const state = single(query.state);
    if (state === null || !state.startsWith(POPUP_STATE_PREFIX)) return 'page';
    if (!POPUP_STATE.test(state)) return 'invalid';
    if (!win.opener) return 'no-opener';
    const code = query.code;
    if (usableCode(code)) win.opener.postMessage({ type: POPUP_MESSAGE, code, state }, win.origin);
    win.close();
    return usableCode(code) ? 'forwarded' : 'closed';
}

/** This window as the callback page sees it; an opener that is this window itself counts as none. */
export function callbackWindow(): CallbackWindow {
    const opener = window.opener as CallbackWindow['opener'] | undefined;
    return {
        opener: opener && opener !== (window as unknown) ? opener : null,
        origin: window.location.origin,
        close: () => window.close(),
    };
}

export const AUTH_KEY: InjectionKey<Auth> = Symbol('auth');
export const CALLBACK_WINDOW_KEY: InjectionKey<CallbackWindow> = Symbol('callback-window');
