import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BackendApi, LoginResult } from './api';
import {
    Auth,
    LOGIN_KEY,
    LoginStateError,
    LoginUnavailable,
    POPUP_MESSAGE,
    PopupBlocked,
    PopupClosed,
    TOKEN_KEY,
    callbackWindow,
    forwardPopupCallback,
    safeReturnPath,
    windowEnv,
    type AuthEnv,
    type CallbackWindow,
    type MessageLike,
    type PopupLike,
} from './auth';
import { BackendProblem } from './problems';

const ORIGIN = 'https://ct.example.org';
const BACKEND = 'https://pw.example.org';
const REDIRECT_PATH = '/ccm/ctpassstore/auth/callback';
const REDIRECT_URI = ORIGIN + REDIRECT_PATH;
const CLIENT = 'client-7';
const NOW = 1_800_000_000_000;

const challengeOf = (verifier: string) => createHash('sha256').update(verifier, 'ascii').digest('base64url');

class MemoryStorage {
    map = new Map<string, string>();
    getItem(k: string) {
        return this.map.has(k) ? this.map.get(k)! : null;
    }
    setItem(k: string, v: string) {
        this.map.set(k, String(v));
    }
    removeItem(k: string) {
        this.map.delete(k);
    }
}

class FakePopup implements PopupLike {
    closed = false;
    urls: string[] = [];
    location = { replace: (url: string) => void this.urls.push(url) };
    close() {
        this.closed = true;
    }
}

interface Harness {
    env: AuthEnv;
    storage: MemoryStorage;
    assigned: string[];
    opened: { url: string; name: string; features: string }[];
    popup: FakePopup | null;
    listeners: Set<(e: MessageLike) => void>;
    timers: Map<() => void, number>;
    now: { value: number };
    /** Runs every interval callback once. */
    tick(): void;
    send(e: MessageLike): void;
}

function harness(): Harness {
    const h: Harness = {
        storage: new MemoryStorage(),
        assigned: [],
        opened: [],
        popup: new FakePopup(),
        listeners: new Set(),
        timers: new Map(),
        now: { value: NOW },
        tick: () => [...h.timers.keys()].forEach((fn) => fn()),
        send: (e) => [...h.listeners].forEach((l) => l(e)),
        env: undefined as unknown as AuthEnv,
    };
    h.env = {
        origin: ORIGIN,
        instanceBaseUrl: `${ORIGIN}/`,
        redirectPath: REDIRECT_PATH,
        storage: () => h.storage,
        assign: (url) => void h.assigned.push(url),
        open: (url, name, features) => {
            h.opened.push({ url, name, features });
            return h.popup;
        },
        listen: (handler) => {
            h.listeners.add(handler);
            return () => h.listeners.delete(handler);
        },
        now: () => h.now.value,
        every: (ms, fn) => {
            h.timers.set(fn, ms);
            return () => h.timers.delete(fn);
        },
    };
    return h;
}

const LOGIN_RESULT: LoginResult = { accessToken: 'tok-123', expiresIn: 900, admin: true, version: '0.1.0' };

function fakeBackend(login: BackendApi['login'] = async () => LOGIN_RESULT) {
    const loginSpy = vi.fn(login);
    const factory = vi.fn((base: string) => ({ base, login: loginSpy }) as unknown as BackendApi);
    return { factory, login: loginSpy };
}

function setup(options: { configure?: boolean } = {}) {
    const h = harness();
    const backend = fakeBackend();
    const auth = new Auth(backend.factory, h.env);
    if (options.configure !== false) auth.configure({ backendUrl: BACKEND, clientId: CLIENT });
    return { h, backend, auth };
}

const storedLogin = (h: Harness) => JSON.parse(h.storage.getItem(LOGIN_KEY)!) as Record<string, unknown>;
const storedToken = (h: Harness) => JSON.parse(h.storage.getItem(TOKEN_KEY)!) as Record<string, unknown>;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Settles within a few microtask turns, or `'pending'`. */
async function settled<T>(p: Promise<T>): Promise<'pending' | 'resolved' | 'rejected'> {
    let state: 'pending' | 'resolved' | 'rejected' = 'pending';
    p.then(
        () => (state = 'resolved'),
        () => (state = 'rejected'),
    );
    await flush();
    return state;
}

/** Starts a page login and returns what was stored and sent. */
async function startLogin(auth: Auth, h: Harness, returnPath = '/manage/5') {
    void auth.startPageLogin(returnPath);
    await vi.waitFor(() => expect(h.assigned).toHaveLength(1));
    return { stored: storedLogin(h), url: new URL(h.assigned[0]!) };
}

describe('safeReturnPath', () => {
    it.each(['/', '/manage/5', '/settings/access/clients/new', '/manage?q=a%20b', '/about#top'])('keeps the app path %s', (p) => {
        expect(safeReturnPath(p)).toBe(p);
    });

    it.each([
        ['an absolute URL', 'https://evil.example/'],
        ['a protocol-relative URL', '//evil.example/x'],
        ['a backslash host', '/\\evil.example'],
        ['a backslash anywhere', '/manage\\x'],
        ['a javascript: URL', 'javascript:alert(1)'],
        ['a relative path', 'manage'],
        ['an empty string', ''],
        ['a tab', '/ma\tnage'],
        ['a newline', '/manage\n'],
        ['a space', '/my page'],
        ['a DEL character', '/manage\x7f'],
        ['a line separator', '/manage\u2028'],
        ['the callback itself', '/auth/callback'],
        ['the callback with a query', '/auth/callback?code=x'],
        ['the callback below a slash', '/auth/callback/'],
        ['a very long path', '/' + 'a'.repeat(2048)],
        ['a number', 5],
        ['null', null],
        ['an array', ['/manage']],
    ])('turns %s into /', (_name, p) => {
        expect(safeReturnPath(p)).toBe('/');
    });

    it('keeps a path of exactly 2048 characters', () => {
        const p = '/' + 'a'.repeat(2047);
        expect(safeReturnPath(p)).toBe(p);
    });

    it('keeps paths that only start like the callback', () => {
        expect(safeReturnPath('/auth/callbacks')).toBe('/auth/callbacks');
        expect(safeReturnPath('/auth')).toBe('/auth');
    });
});

describe('Auth.startPageLogin', () => {
    it('stores state, verifier, return path and backend, then redirects to ChurchTools', async () => {
        const { h, auth } = setup();
        const { stored, url } = await startLogin(auth, h);

        expect(Object.keys(stored).sort()).toEqual(['backendUrl', 'returnPath', 'state', 'verifier']);
        expect(stored.returnPath).toBe('/manage/5');
        expect(stored.backendUrl).toBe(BACKEND);
        expect(stored.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(stored.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

        expect(url.origin + url.pathname).toBe(`${ORIGIN}/oauth/authorize`);
        expect(url.searchParams.get('client_id')).toBe(CLIENT);
        expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('scope')).toBe('api');
        expect(url.searchParams.get('state')).toBe(stored.state);
        expect(url.searchParams.get('code_challenge')).toBe(challengeOf(stored.verifier as string));
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.has('code_verifier')).toBe(false);
        expect(h.assigned[0]).not.toContain(stored.verifier as string);
    });

    it('uses a new state and verifier for every login', async () => {
        const a = setup();
        const b = setup();
        const first = (await startLogin(a.auth, a.h)).stored;
        const second = (await startLogin(b.auth, b.h)).stored;
        expect(first.state).not.toBe(second.state);
        expect(first.verifier).not.toBe(second.verifier);
    });

    it('never settles, because the page goes away', async () => {
        const { auth } = setup();
        expect(await settled(auth.startPageLogin('/'))).toBe('pending');
    });

    it('stores / instead of an unsafe return path', async () => {
        const { h, auth } = setup();
        const { stored } = await startLogin(auth, h, '//evil.example/x');
        expect(stored.returnPath).toBe('/');
    });

    it('refuses without configuration and does not redirect', async () => {
        const { h, auth } = setup({ configure: false });
        await expect(auth.startPageLogin('/')).rejects.toBeInstanceOf(LoginUnavailable);
        expect(h.assigned).toEqual([]);
    });

    it('does not redirect when sessionStorage cannot be read at all', async () => {
        const { h, auth } = setup();
        h.env.storage = () => {
            throw new Error('SecurityError');
        };
        await expect(auth.startPageLogin('/')).rejects.toBeInstanceOf(LoginUnavailable);
        expect(h.assigned).toEqual([]);
    });

    it('does not redirect when sessionStorage drops writes silently', async () => {
        const { h, auth } = setup();
        h.storage.setItem = () => undefined;
        await expect(auth.startPageLogin('/')).rejects.toBeInstanceOf(LoginUnavailable);
        expect(h.assigned).toEqual([]);
    });

    it('does not redirect when the login data cannot be stored (no endless login loop)', async () => {
        const { h, auth } = setup();
        h.storage.setItem = () => {
            throw new Error('QuotaExceededError');
        };
        await expect(auth.startPageLogin('/')).rejects.toBeInstanceOf(LoginUnavailable);
        expect(h.assigned).toEqual([]);
        const nullStorage = setup();
        nullStorage.h.env.storage = () => null;
        await expect(nullStorage.auth.startPageLogin('/')).rejects.toBeInstanceOf(LoginUnavailable);
        expect(nullStorage.h.assigned).toEqual([]);
    });
});

describe('Auth.completePageLogin', () => {
    it('exchanges the code with the stored verifier, stores the token and returns the path', async () => {
        const { h, auth, backend } = setup();
        const { stored } = await startLogin(auth, h);

        const path = await auth.completePageLogin({ code: 'the-code', state: stored.state });

        expect(path).toBe('/manage/5');
        expect(backend.factory).toHaveBeenCalledWith(BACKEND);
        expect(backend.login).toHaveBeenCalledExactlyOnceWith('the-code', stored.verifier, REDIRECT_URI);
        expect(storedToken(h)).toEqual({ accessToken: 'tok-123', expiresAt: NOW + 900_000, admin: true, version: '0.1.0', backend: `${BACKEND}/v1` });
        expect(auth.token()).toBe('tok-123');
        expect(auth.info()).toEqual({ admin: true, version: '0.1.0' });
        expect(h.storage.getItem(LOGIN_KEY)).toBeNull();
    });

    it('works on a fresh page that has no configuration yet (uses the stored backend)', async () => {
        const { h, auth } = setup();
        const { stored } = await startLogin(auth, h);
        const backend = fakeBackend();
        const fresh = new Auth(backend.factory, h.env);
        await fresh.completePageLogin({ code: 'c', state: stored.state });
        expect(backend.factory).toHaveBeenCalledWith(BACKEND);
        expect(backend.login).toHaveBeenCalledOnce();
    });

    it.each([
        ['a different state', (s: string) => s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')],
        ['the state in other case', (s: string) => (s.toUpperCase() === s ? s.toLowerCase() : s.toUpperCase())],
        ['the state with an extra character', (s: string) => s + 'x'],
        ['a prefix of the state', (s: string) => s.slice(0, -1)],
        ['an empty state', () => ''],
        ['no state', () => undefined],
        ['the state twice', (s: string) => [s, s]],
    ])('rejects %s and stores no token', async (_name, mutate) => {
        const { h, auth, backend } = setup();
        const { stored } = await startLogin(auth, h);
        await expect(auth.completePageLogin({ code: 'c', state: mutate(stored.state as string) })).rejects.toBeInstanceOf(LoginStateError);
        expect(backend.login).not.toHaveBeenCalled();
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
        expect(auth.token()).toBeNull();
        expect(h.storage.getItem(LOGIN_KEY)).toBeNull();
    });

    it('rejects a callback when no login was started', async () => {
        const { h, auth, backend } = setup();
        await expect(auth.completePageLogin({ code: 'c', state: 'anything' })).rejects.toBeInstanceOf(LoginStateError);
        expect(backend.login).not.toHaveBeenCalled();
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
    });

    it.each([
        ['not JSON', '{'],
        ['an array', '[]'],
        ['null', 'null'],
        ['no verifier', JSON.stringify({ state: 's'.repeat(43), returnPath: '/', backendUrl: BACKEND })],
        ['an empty state', JSON.stringify({ state: '', verifier: 'v'.repeat(43), returnPath: '/', backendUrl: BACKEND })],
        ['no backend', JSON.stringify({ state: 's'.repeat(43), verifier: 'v'.repeat(43), returnPath: '/' })],
        ['a numeric state', JSON.stringify({ state: 1, verifier: 'v'.repeat(43), returnPath: '/', backendUrl: BACKEND })],
    ])('rejects when the stored login data is %s', async (_name, raw) => {
        const { h, auth, backend } = setup();
        h.storage.setItem(LOGIN_KEY, raw);
        await expect(auth.completePageLogin({ code: 'c', state: 's'.repeat(43) })).rejects.toBeInstanceOf(LoginStateError);
        expect(backend.login).not.toHaveBeenCalled();
        expect(h.storage.getItem(LOGIN_KEY)).toBeNull();
    });

    it.each([
        ['no code', {}],
        ['an empty code', { code: '' }],
        ['two codes', { code: ['a', 'b'] }],
        ['a code that is too long', { code: 'c'.repeat(4097) }],
    ])('rejects %s and still removes the login data', async (_name, extra) => {
        const { h, auth, backend } = setup();
        const { stored } = await startLogin(auth, h);
        await expect(auth.completePageLogin({ state: stored.state, ...extra })).rejects.toBeInstanceOf(LoginStateError);
        expect(backend.login).not.toHaveBeenCalled();
        expect(h.storage.getItem(LOGIN_KEY)).toBeNull();
    });

    it('accepts a code of exactly 4096 characters', async () => {
        const { h, auth, backend } = setup();
        const { stored } = await startLogin(auth, h);
        await auth.completePageLogin({ code: 'c'.repeat(4096), state: stored.state });
        expect(backend.login).toHaveBeenCalledOnce();
    });

    it('does not accept the same callback twice', async () => {
        const { h, auth, backend } = setup();
        const { stored } = await startLogin(auth, h);
        const query = { code: 'c', state: stored.state };
        await auth.completePageLogin(query);
        auth.clear();
        await expect(auth.completePageLogin(query)).rejects.toBeInstanceOf(LoginStateError);
        expect(backend.login).toHaveBeenCalledOnce();
        expect(auth.token()).toBeNull();
    });

    it('removes the login data when the backend refuses the code, and stores no token', async () => {
        const h = harness();
        const refused = new BackendProblem('oauth-code-invalid', 400);
        const backend = fakeBackend(async () => {
            throw refused;
        });
        const auth = new Auth(backend.factory, h.env);
        auth.configure({ backendUrl: BACKEND, clientId: CLIENT });
        const { stored } = await startLogin(auth, h);
        await expect(auth.completePageLogin({ code: 'c', state: stored.state })).rejects.toBe(refused);
        expect(h.storage.getItem(LOGIN_KEY)).toBeNull();
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
        expect(auth.token()).toBeNull();
    });

    it('returns / when the stored return path was tampered with', async () => {
        const { h, auth } = setup();
        const { stored } = await startLogin(auth, h);
        h.storage.setItem(LOGIN_KEY, JSON.stringify({ ...stored, returnPath: 'https://evil.example/' }));
        expect(await auth.completePageLogin({ code: 'c', state: stored.state })).toBe('/');
    });

    it('puts neither code nor state nor verifier into its errors', async () => {
        const { h, auth } = setup();
        const { stored } = await startLogin(auth, h);
        const error = await auth.completePageLogin({ code: 'secret-code', state: 'wrong-state' }).then(
            () => new Error('resolved'),
            (e: unknown) => e as Error,
        );
        const text = `${error.message} ${error.name} ${JSON.stringify(error)} ${String((error as { cause?: unknown }).cause)}`;
        for (const secret of ['secret-code', 'wrong-state', stored.state as string, stored.verifier as string]) expect(text).not.toContain(secret);
    });

    it('needs a working sessionStorage', async () => {
        const { h, auth } = setup();
        h.env.storage = () => {
            throw new Error('SecurityError');
        };
        await expect(auth.completePageLogin({ code: 'c', state: 's' })).rejects.toBeInstanceOf(LoginStateError);
    });
});

describe('Auth token', () => {
    async function loggedIn() {
        const s = setup();
        const { stored } = await startLogin(s.auth, s.h);
        await s.auth.completePageLogin({ code: 'c', state: stored.state });
        return s;
    }

    it('is null before any login', () => {
        const { auth } = setup();
        expect(auth.token()).toBeNull();
        expect(auth.info()).toBeNull();
        expect(auth.expiresInMs()).toBe(0);
    });

    it('is restored from sessionStorage by a new instance on the same backend', async () => {
        const { h } = await loggedIn();
        const again = new Auth(fakeBackend().factory, h.env);
        again.configure({ backendUrl: `${BACKEND}/`, clientId: CLIENT });
        expect(again.token()).toBe('tok-123');
    });

    it('is bound to its backend: another backend gets no token and the stored one is dropped', async () => {
        const { h } = await loggedIn();
        const again = new Auth(fakeBackend().factory, h.env);
        again.configure({ backendUrl: 'https://other.example.org', clientId: CLIENT });
        expect(again.token()).toBeNull();
        expect(again.info()).toBeNull();
        expect(again.expiresInMs()).toBe(0);
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('is dropped when the backend setting changes during the session', async () => {
        const { h, auth } = await loggedIn();
        auth.configure({ backendUrl: `${BACKEND}/other`, clientId: CLIENT });
        expect(auth.token()).toBeNull();
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
        auth.configure({ backendUrl: BACKEND, clientId: CLIENT });
        expect(auth.token()).toBeNull();
    });

    it('is not handed out before configuration, but kept', async () => {
        const { h } = await loggedIn();
        const again = new Auth(fakeBackend().factory, h.env);
        expect(again.token()).toBeNull();
        expect(h.storage.getItem(TOKEN_KEY)).not.toBeNull();
        again.configure({ backendUrl: BACKEND, clientId: CLIENT });
        expect(again.token()).toBe('tok-123');
    });

    it.each([
        ['not JSON', 'x'],
        ['without backend', JSON.stringify({ accessToken: 't', expiresAt: NOW + 1, admin: false, version: '1' })],
        ['with an empty token', JSON.stringify({ accessToken: '', expiresAt: NOW + 1, admin: false, version: '1', backend: `${BACKEND}/v1` })],
        ['with a string expiry', JSON.stringify({ accessToken: 't', expiresAt: '1', admin: false, version: '1', backend: `${BACKEND}/v1` })],
        ['with a string admin', JSON.stringify({ accessToken: 't', expiresAt: NOW + 1, admin: 'true', version: '1', backend: `${BACKEND}/v1` })],
    ])('ignores and removes a stored token %s', (_name, raw) => {
        const h = harness();
        h.storage.setItem(TOKEN_KEY, raw);
        const auth = new Auth(fakeBackend().factory, h.env);
        auth.configure({ backendUrl: BACKEND, clientId: CLIENT });
        expect(auth.token()).toBeNull();
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('counts down the time left and never below zero', async () => {
        const { h, auth } = await loggedIn();
        expect(auth.expiresInMs()).toBe(900_000);
        h.now.value += 899_999;
        expect(auth.expiresInMs()).toBe(1);
        h.now.value += 1;
        expect(auth.expiresInMs()).toBe(0);
        h.now.value += 5_000;
        expect(auth.expiresInMs()).toBe(0);
        // The backend decides about an expired token (so `token-expired` leads to a popup renewal).
        expect(auth.token()).toBe('tok-123');
    });

    it('clear() removes it from memory and sessionStorage', async () => {
        const { h, auth } = await loggedIn();
        auth.clear();
        expect(auth.token()).toBeNull();
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('stays in memory when sessionStorage refuses to store it', async () => {
        const { h, auth } = setup();
        const { stored } = await startLogin(auth, h);
        h.storage.setItem = () => {
            throw new Error('QuotaExceededError');
        };
        await auth.completePageLogin({ code: 'c', state: stored.state });
        expect(auth.token()).toBe('tok-123');
    });

    it('works without sessionStorage at all (popup login keeps it in memory)', async () => {
        const { h, auth } = setup();
        h.env.storage = () => {
            throw new Error('SecurityError');
        };
        expect(auth.token()).toBeNull();
        auth.clear();
        const done = auth.loginInPopup();
        await vi.waitFor(() => expect(h.popup!.urls).toHaveLength(1));
        const state = new URL(h.popup!.urls[0]!).searchParams.get('state')!;
        h.send({ origin: ORIGIN, source: h.popup, data: { type: POPUP_MESSAGE, code: 'c', state } });
        await done;
        expect(auth.token()).toBe('tok-123');
    });
});

describe('Auth.loginInPopup', () => {
    async function openPopup() {
        const s = setup();
        const done = s.auth.loginInPopup();
        done.catch(() => undefined);
        await vi.waitFor(() => expect(s.h.popup!.urls).toHaveLength(1));
        const url = new URL(s.h.popup!.urls[0]!);
        const state = url.searchParams.get('state')!;
        const challenge = url.searchParams.get('code_challenge')!;
        const good = (data: Record<string, unknown> = {}): MessageLike => ({
            origin: ORIGIN,
            source: s.h.popup,
            data: { type: POPUP_MESSAGE, code: 'popup-code', state, ...data },
        });
        return { ...s, done, url, state, challenge, good };
    }

    it('opens the popup synchronously, inside the click handler', () => {
        const { h, auth } = setup();
        void auth.loginInPopup().catch(() => undefined);
        expect(h.opened).toHaveLength(1);
        expect(h.opened[0]!.url).toBe('about:blank');
        expect(h.opened[0]!.features).not.toContain('noopener');
    });

    it('rejects with PopupBlocked when the browser blocks it, and listens to nothing', async () => {
        const { h, auth } = setup();
        h.popup = null;
        await expect(auth.loginInPopup()).rejects.toBeInstanceOf(PopupBlocked);
        expect(h.listeners.size).toBe(0);
        expect(h.timers.size).toBe(0);
    });

    it('counts a throwing window.open as blocked', async () => {
        const { h, auth } = setup();
        h.env.open = () => {
            throw new Error('blocked');
        };
        await expect(auth.loginInPopup()).rejects.toBeInstanceOf(PopupBlocked);
        expect(h.listeners.size).toBe(0);
    });

    it('closes the popup again when it cannot be sent to ChurchTools', async () => {
        const { h, auth } = setup();
        const failure = new Error('navigation failed');
        h.popup!.location.replace = () => {
            throw failure;
        };
        await expect(auth.loginInPopup()).rejects.toBe(failure);
        expect(h.popup!.closed).toBe(true);
        expect(h.listeners.size).toBe(0);
        expect(h.timers.size).toBe(0);
    });

    it('rejects without configuration and opens nothing', async () => {
        const { h, auth } = setup({ configure: false });
        await expect(auth.loginInPopup()).rejects.toBeInstanceOf(LoginUnavailable);
        expect(h.opened).toEqual([]);
    });

    it('sends the popup to ChurchTools with a popup state', async () => {
        const { url, state } = await openPopup();
        expect(url.origin + url.pathname).toBe(`${ORIGIN}/oauth/authorize`);
        expect(url.searchParams.get('client_id')).toBe(CLIENT);
        expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
        expect(url.searchParams.get('scope')).toBe('api');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(state).toMatch(/^p\.[A-Za-z0-9_-]{43}$/);
    });

    it('keeps state and verifier in memory only', async () => {
        const { h } = await openPopup();
        expect(h.storage.getItem(LOGIN_KEY)).toBeNull();
        expect([...h.storage.map.keys()]).toEqual([]);
    });

    it('exchanges the code from a matching message with its own verifier and stores the token', async () => {
        const { h, auth, backend, done, good, challenge } = await openPopup();
        h.send(good());
        await done;
        expect(backend.factory).toHaveBeenCalledWith(BACKEND);
        expect(backend.login).toHaveBeenCalledOnce();
        const [code, verifier, redirectUri] = backend.login.mock.calls[0]!;
        expect(code).toBe('popup-code');
        expect(challengeOf(verifier)).toBe(challenge);
        expect(redirectUri).toBe(REDIRECT_URI);
        expect(auth.token()).toBe('tok-123');
        expect(storedToken(h).backend).toBe(`${BACKEND}/v1`);
        expect(h.listeners.size).toBe(0);
        expect(h.timers.size).toBe(0);
    });

    it.each([
        ['another origin', { origin: 'https://evil.example' }],
        ['the opener origin with a path-like suffix', { origin: `${ORIGIN}.evil.example` }],
        ['a null origin', { origin: 'null' }],
        ['another window', { source: {} }],
        ['no window', { source: null }],
    ])('ignores a message from %s', async (_name, override) => {
        const { h, backend, done, good } = await openPopup();
        h.send({ ...good(), ...override });
        await flush();
        expect(backend.login).not.toHaveBeenCalled();
        expect(await settled(done)).toBe('pending');
        h.send(good());
        await done;
        expect(backend.login).toHaveBeenCalledOnce();
    });

    it.each([
        ['a wrong state', { state: 'p.wrong' }],
        ['the state without its prefix', { state: 'STRIP' }],
        ['a numeric state', { state: 1 }],
        ['no code', { code: undefined }],
        ['an empty code', { code: '' }],
        ['a numeric code', { code: 7 }],
        ['a code that is too long', { code: 'c'.repeat(4097) }],
        ['another type', { type: 'other' }],
    ])('ignores a message with %s', async (_name, data) => {
        const { h, backend, done, good, state } = await openPopup();
        const patched = { ...data } as Record<string, unknown>;
        if (patched.state === 'STRIP') patched.state = state.slice(2);
        h.send(good(patched));
        h.send({ origin: ORIGIN, source: h.popup, data: 'not an object' });
        h.send({ origin: ORIGIN, source: h.popup, data: null });
        await flush();
        expect(backend.login).not.toHaveBeenCalled();
        expect(await settled(done)).toBe('pending');
    });

    it('ignores a replayed message after the login', async () => {
        const { h, backend, done, good } = await openPopup();
        h.send(good());
        await done;
        h.send(good({ code: 'second' }));
        await flush();
        expect(backend.login).toHaveBeenCalledOnce();
    });

    it('checks twice a second whether the popup is still open', async () => {
        const { h } = await openPopup();
        expect([...h.timers.values()]).toEqual([500]);
    });

    it('rejects with PopupClosed when the person closes the popup', async () => {
        const { h, backend, done } = await openPopup();
        h.popup!.closed = true;
        h.tick();
        h.tick();
        await expect(done).rejects.toBeInstanceOf(PopupClosed);
        expect(backend.login).not.toHaveBeenCalled();
        expect(h.listeners.size).toBe(0);
        expect(h.timers.size).toBe(0);
        expect(h.storage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('waits one more check after seeing the popup closed (the callback closes right after posting)', async () => {
        const { h, done, good } = await openPopup();
        h.tick();
        h.popup!.closed = true;
        h.tick();
        expect(await settled(done)).toBe('pending');
        h.send(good());
        await expect(done).resolves.toBeUndefined();
    });

    it('does not reject while the popup stays open', async () => {
        const { h, done } = await openPopup();
        for (let i = 0; i < 100; i++) h.tick();
        expect(await settled(done)).toBe('pending');
    });

    it('passes on a refused code and stores no token', async () => {
        const h = harness();
        const refused = new BackendProblem('oauth-code-invalid', 400);
        const backend = fakeBackend(async () => {
            throw refused;
        });
        const auth = new Auth(backend.factory, h.env);
        auth.configure({ backendUrl: BACKEND, clientId: CLIENT });
        const done = auth.loginInPopup();
        done.catch(() => undefined);
        await vi.waitFor(() => expect(h.popup!.urls).toHaveLength(1));
        const state = new URL(h.popup!.urls[0]!).searchParams.get('state')!;
        h.send({ origin: ORIGIN, source: h.popup, data: { type: POPUP_MESSAGE, code: 'c', state } });
        await expect(done).rejects.toBe(refused);
        expect(auth.token()).toBeNull();
    });

    it('uses a fresh state and verifier for each popup', async () => {
        const a = await openPopup();
        const b = await openPopup();
        expect(a.state).not.toBe(b.state);
        expect(a.challenge).not.toBe(b.challenge);
    });
});

describe('forwardPopupCallback', () => {
    const popupState = 'p.' + 'a'.repeat(43);

    function win(opener: CallbackWindow['opener']) {
        return { opener, origin: ORIGIN, close: vi.fn() };
    }

    it('posts code and state to the opener with its own origin as target and closes', () => {
        const opener = { postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>() };
        const w = win(opener);
        expect(forwardPopupCallback({ code: 'c', state: popupState }, w)).toBe('forwarded');
        expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith({ type: POPUP_MESSAGE, code: 'c', state: popupState }, ORIGIN);
        expect(opener.postMessage.mock.calls[0]![1]).not.toBe('*');
        expect(w.close).toHaveBeenCalledOnce();
    });

    it('treats a page-login state as a page even with an opener', () => {
        const opener = { postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>() };
        const w = win(opener);
        expect(forwardPopupCallback({ code: 'c', state: 'a'.repeat(43) }, w)).toBe('page');
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(w.close).not.toHaveBeenCalled();
    });

    it('reports a popup state without an opener and posts nothing', () => {
        const w = win(null);
        expect(forwardPopupCallback({ code: 'c', state: popupState }, w)).toBe('no-opener');
        expect(w.close).not.toHaveBeenCalled();
    });

    it('closes a popup without a code (the person declined) without posting', () => {
        const opener = { postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>() };
        const w = win(opener);
        expect(forwardPopupCallback({ error: 'access_denied', state: popupState }, w)).toBe('closed');
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(w.close).toHaveBeenCalledOnce();
    });
});

describe('the real browser wiring', () => {
    it('windowEnv listens to window messages until removed and uses sessionStorage', () => {
        const env = windowEnv();
        expect(env.origin).toBe(window.location.origin);
        expect(env.storage()).toBe(window.sessionStorage);
        const seen: MessageLike[] = [];
        const stop = env.listen((e) => seen.push(e));
        window.dispatchEvent(new MessageEvent('message', { data: { a: 1 }, origin: 'https://x.example' }));
        stop();
        window.dispatchEvent(new MessageEvent('message', { data: { a: 2 }, origin: 'https://x.example' }));
        expect(seen.map((e) => [e.origin, e.data])).toEqual([['https://x.example', { a: 1 }]]);
    });

    it('windowEnv runs an interval until stopped', () => {
        vi.useFakeTimers();
        try {
            const fn = vi.fn();
            const stop = windowEnv().every(500, fn);
            vi.advanceTimersByTime(1000);
            stop();
            vi.advanceTimersByTime(1000);
            expect(fn).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('callbackWindow sees an opener, but not the window itself', () => {
        const original = Object.getOwnPropertyDescriptor(window, 'opener');
        try {
            const other = { postMessage: vi.fn() };
            Object.defineProperty(window, 'opener', { value: other, configurable: true });
            expect(callbackWindow().opener).toBe(other);
            Object.defineProperty(window, 'opener', { value: window, configurable: true });
            expect(callbackWindow().opener).toBeNull();
            Object.defineProperty(window, 'opener', { value: null, configurable: true });
            expect(callbackWindow().opener).toBeNull();
            expect(callbackWindow().origin).toBe(window.location.origin);
        } finally {
            if (original) Object.defineProperty(window, 'opener', original);
        }
    });
});
