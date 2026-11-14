/* eslint-disable vue/one-component-per-file -- small probe components that call useSession() */
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import type { BackendApi, LoginResult } from '../backend/api';
import { Auth, LOGIN_KEY, LoginUnavailable, POPUP_MESSAGE, PersonMismatch, PopupBlocked, PopupClosed, TOKEN_KEY, type AuthEnv, type MessageLike, type PopupLike } from '../backend/auth';
import { BackendProblem } from '../backend/problems';
import { LoginLoop, SESSION_KEY, createSession, useSession, type SessionAuth } from './useSession';

function fakeAuth(options: { expiresInMs?: number; admin?: boolean; version?: string } = {}) {
    const state = {
        expiresInMs: options.expiresInMs ?? 600_000,
        info: { admin: options.admin ?? false, version: options.version ?? '0.1.0' } as { admin: boolean; version: string } | null,
        scope: 'B#1' as string | null,
        recent: false,
    };
    const listeners = new Set<() => void>();
    const auth = {
        loginInPopup: vi.fn(async () => undefined),
        startPageLogin: vi.fn((path: string) => new Promise<never>(() => void path)),
        clear: vi.fn(() => undefined),
        info: vi.fn(() => state.info),
        expiresInMs: vi.fn(() => state.expiresInMs),
        scope: vi.fn(() => state.scope),
        recentPageLogin: vi.fn(() => state.recent),
        subscribe: vi.fn((fn: () => void) => {
            listeners.add(fn);
            return () => void listeners.delete(fn);
        }),
    } satisfies SessionAuth;
    /** What a real Auth does after a new token. */
    const emit = () => listeners.forEach((fn) => fn());
    return { auth, state, emit };
}

const problem = (slug: string, status = 401) => new BackendProblem(slug, status);
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function settled<T>(p: Promise<T>): Promise<'pending' | 'resolved' | 'rejected'> {
    let s: 'pending' | 'resolved' | 'rejected' = 'pending';
    p.then(
        () => (s = 'resolved'),
        () => (s = 'rejected'),
    );
    await flush();
    return s;
}

describe('createSession', () => {
    it('starts with role and version of the stored token', () => {
        const { auth } = fakeAuth({ admin: true, version: '0.1.4' });
        const session = createSession(auth, () => '/');
        expect(session.admin.value).toBe(true);
        expect(session.backendVersion.value).toBe('0.1.4');
        expect(session.needsRenewal.value).toBe(false);
    });

    it('starts without role and version when there is no token', () => {
        const { auth, state } = fakeAuth();
        state.info = null;
        const session = createSession(auth, () => '/');
        expect(session.admin.value).toBe(false);
        expect(session.backendVersion.value).toBeNull();
    });
});

describe('role and version', () => {
    it('keep their last values when a change leaves no usable token', () => {
        const { auth, state, emit } = fakeAuth({ admin: true, version: '0.1.4' });
        const session = createSession(auth, () => '/');
        state.info = null;
        emit();
        expect(session.admin.value).toBe(true);
        expect(session.backendVersion.value).toBe('0.1.4');
        state.info = { admin: false, version: '0.1.5' };
        emit();
        expect(session.admin.value).toBe(false);
        expect(session.backendVersion.value).toBe('0.1.5');
    });
});

describe('role and version are display-only and follow the scope', () => {
    it('are reset when the backend or person changes, before the new token is read', () => {
        const { auth, state, emit } = fakeAuth({ admin: true, version: '0.1.4' });
        const session = createSession(auth, () => '/');
        state.scope = 'C#1';
        state.info = null;
        emit();
        expect(session.admin.value).toBe(false);
        expect(session.backendVersion.value).toBeNull();
        state.info = { admin: true, version: '0.2.0' };
        emit();
        expect(session.admin.value).toBe(true);
        expect(session.backendVersion.value).toBe('0.2.0');
    });

    it('are not reset when the scope stays the same', () => {
        const { auth, state, emit } = fakeAuth({ admin: true, version: '0.1.4' });
        const session = createSession(auth, () => '/');
        state.info = null;
        emit();
        expect(session.admin.value).toBe(true);
    });
});

describe('ensureFresh', () => {
    it.each([
        [121_000, false],
        [120_001, false],
        [120_000, false],
        [119_999, true],
        [0, true],
    ])('with %i ms left renews: %s', async (left, renews) => {
        const { auth } = fakeAuth({ expiresInMs: left });
        await createSession(auth, () => '/').ensureFresh();
        expect(auth.loginInPopup).toHaveBeenCalledTimes(renews ? 1 : 0);
    });

    it('takes role and version from the renewed token', async () => {
        const { auth, state, emit } = fakeAuth({ expiresInMs: 0 });
        const session = createSession(auth, () => '/');
        auth.loginInPopup.mockImplementation(async () => {
            state.info = { admin: true, version: '0.1.9' };
            emit();
        });
        await session.ensureFresh();
        expect(session.admin.value).toBe(true);
        expect(session.backendVersion.value).toBe('0.1.9');
    });

    it.each([
        ['blocked', () => new PopupBlocked()],
        ['closed', () => new PopupClosed()],
    ])('sets needsRenewal and rejects when the popup is %s', async (_name, make) => {
        const { auth } = fakeAuth({ expiresInMs: 0 });
        const error = make();
        auth.loginInPopup.mockRejectedValue(error);
        const session = createSession(auth, () => '/');
        await expect(session.ensureFresh()).rejects.toBe(error);
        expect(session.needsRenewal.value).toBe(true);
        expect(auth.clear).not.toHaveBeenCalled();
        expect(auth.startPageLogin).not.toHaveBeenCalled();
    });

    it('does not set needsRenewal for other failures', async () => {
        const { auth } = fakeAuth({ expiresInMs: 0 });
        const error = problem('oauth-code-invalid', 400);
        auth.loginInPopup.mockRejectedValue(error);
        const session = createSession(auth, () => '/');
        await expect(session.ensureFresh()).rejects.toBe(error);
        expect(session.needsRenewal.value).toBe(false);
    });
});

describe('renew', () => {
    it('clears needsRenewal after a successful popup login', async () => {
        const { auth } = fakeAuth();
        auth.loginInPopup.mockRejectedValueOnce(new PopupBlocked());
        const session = createSession(auth, () => '/');
        await expect(session.renew()).rejects.toBeInstanceOf(PopupBlocked);
        expect(session.needsRenewal.value).toBe(true);
        await session.renew();
        expect(session.needsRenewal.value).toBe(false);
    });

    it('opens one popup for renewals that overlap', async () => {
        const { auth } = fakeAuth();
        let finish!: () => void;
        auth.loginInPopup.mockImplementation(() => new Promise<undefined>((r) => (finish = () => r(undefined))));
        const session = createSession(auth, () => '/');
        const a = session.renew();
        const b = session.renew();
        finish();
        await Promise.all([a, b]);
        expect(auth.loginInPopup).toHaveBeenCalledOnce();
        auth.loginInPopup.mockResolvedValue(undefined);
        await session.renew();
        expect(auth.loginInPopup).toHaveBeenCalledTimes(2);
    });
});

describe('call', () => {
    it('passes the result through', async () => {
        const { auth } = fakeAuth();
        expect(await createSession(auth, () => '/').call(async () => 42)).toBe(42);
        expect(auth.loginInPopup).not.toHaveBeenCalled();
    });

    it('on token-expired renews through the popup and sends the request exactly once more', async () => {
        const { auth } = fakeAuth();
        const fn = vi.fn().mockRejectedValueOnce(problem('token-expired')).mockResolvedValueOnce('ok');
        const session = createSession(auth, () => '/');
        expect(await session.call(fn)).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
        expect(auth.loginInPopup).toHaveBeenCalledOnce();
        expect(auth.loginInPopup.mock.invocationCallOrder[0]!).toBeLessThan(fn.mock.invocationCallOrder[1]!);
    });

    it('does not retry a second time when the retry fails with token-expired again', async () => {
        const { auth } = fakeAuth();
        const second = problem('token-expired');
        const fn = vi.fn().mockRejectedValueOnce(problem('token-expired')).mockRejectedValueOnce(second).mockResolvedValue('never');
        const session = createSession(auth, () => '/');
        await expect(session.call(fn)).rejects.toBe(second);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(auth.loginInPopup).toHaveBeenCalledOnce();
    });

    it('passes on any other failure of the retry unchanged', async () => {
        const { auth } = fakeAuth();
        const second = problem('forbidden', 403);
        const fn = vi.fn().mockRejectedValueOnce(problem('token-expired')).mockRejectedValueOnce(second);
        await expect(createSession(auth, () => '/').call(fn)).rejects.toBe(second);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it.each(['forbidden', 'oauth-code-invalid', 'internal-error', 'too-many-attempts', 'entry-not-found'])(
        'does not retry on %s',
        async (slug) => {
            const { auth } = fakeAuth();
            const error = problem(slug, 403);
            const fn = vi.fn().mockRejectedValue(error);
            await expect(createSession(auth, () => '/').call(fn)).rejects.toBe(error);
            expect(fn).toHaveBeenCalledOnce();
            expect(auth.loginInPopup).not.toHaveBeenCalled();
            expect(auth.clear).not.toHaveBeenCalled();
            expect(auth.startPageLogin).not.toHaveBeenCalled();
        },
    );

    it('does not retry on errors that are not backend problems', async () => {
        const { auth } = fakeAuth();
        const error = new Error('token-expired');
        const fn = vi.fn().mockRejectedValue(error);
        await expect(createSession(auth, () => '/').call(fn)).rejects.toBe(error);
        expect(fn).toHaveBeenCalledOnce();
        expect(auth.loginInPopup).not.toHaveBeenCalled();
    });

    it('a blocked popup sets needsRenewal, rejects with PopupBlocked and resets nothing', async () => {
        const { auth } = fakeAuth({ admin: true });
        auth.loginInPopup.mockRejectedValue(new PopupBlocked());
        const fn = vi.fn(async () => {
            throw problem('token-expired');
        });
        const session = createSession(auth, () => '/');
        await expect(session.call(fn)).rejects.toBeInstanceOf(PopupBlocked);
        expect(fn).toHaveBeenCalledOnce();
        expect(session.needsRenewal.value).toBe(true);
        expect(session.admin.value).toBe(true);
        expect(auth.clear).not.toHaveBeenCalled();
        expect(auth.startPageLogin).not.toHaveBeenCalled();
    });

    it.each(['invalid-token', 'missing-token'])('on %s without unsaved input drops the token and starts a page login', async (slug) => {
        const { auth } = fakeAuth();
        const fn = vi.fn().mockRejectedValue(problem(slug));
        const session = createSession(auth, () => '/manage/12');
        const result = session.call(fn);
        expect(await settled(result)).toBe('pending');
        expect(auth.clear).toHaveBeenCalledOnce();
        expect(auth.startPageLogin).toHaveBeenCalledExactlyOnceWith('/manage/12');
        expect(auth.clear.mock.invocationCallOrder[0]!).toBeLessThan(auth.startPageLogin.mock.invocationCallOrder[0]!);
        expect(auth.loginInPopup).not.toHaveBeenCalled();
        expect(fn).toHaveBeenCalledOnce();
    });

    it.each(['invalid-token', 'missing-token'])('on %s with unsaved input drops the token, sets needsRenewal and keeps the page', async (slug) => {
        const { auth } = fakeAuth({ admin: true, version: '0.1.2' });
        const error = problem(slug);
        const session = createSession(auth, () => '/');
        session.trackUnsaved(() => false);
        session.trackUnsaved(() => true);
        await expect(session.call(() => Promise.reject(error))).rejects.toBe(error);
        expect(auth.clear).toHaveBeenCalledOnce();
        expect(session.needsRenewal.value).toBe(true);
        expect(auth.startPageLogin).not.toHaveBeenCalled();
        expect(auth.loginInPopup).not.toHaveBeenCalled();
        // The frame stays as it was until the renewal.
        expect(session.admin.value).toBe(true);
        expect(session.backendVersion.value).toBe('0.1.2');
    });

    it.each(['invalid-token', 'missing-token'])('on %s right after a page login does not log in again (loop guard)', async (slug) => {
        const { auth, state } = fakeAuth();
        state.recent = true;
        const session = createSession(auth, () => '/');
        expect(session.loginLoop.value).toBe(false);
        await expect(session.call(() => Promise.reject(problem(slug)))).rejects.toBeInstanceOf(LoginLoop);
        expect(auth.startPageLogin).not.toHaveBeenCalled();
        expect(auth.clear).toHaveBeenCalledOnce();
        expect(session.loginLoop.value).toBe(true);
    });

    it('the loop guard error carries no token problem detail', async () => {
        const { auth, state } = fakeAuth();
        state.recent = true;
        const error = await createSession(auth, () => '/')
            .call(() => Promise.reject(problem('invalid-token')))
            .catch((e: unknown) => e as Error);
        expect(error.name).toBe('LoginLoop');
    });

    it('a renewal that returns another person starts a page login and does not resend', async () => {
        const { auth } = fakeAuth();
        auth.loginInPopup.mockRejectedValue(new PersonMismatch());
        const fn = vi.fn().mockRejectedValue(problem('token-expired'));
        const session = createSession(auth, () => '/manage/3');
        expect(await settled(session.call(fn))).toBe('pending');
        expect(auth.startPageLogin).toHaveBeenCalledExactlyOnceWith('/manage/3');
        expect(fn).toHaveBeenCalledOnce();
        expect(session.needsRenewal.value).toBe(false);
    });

    it('a renewal that returns another person right after a page login hits the loop guard', async () => {
        const { auth, state } = fakeAuth();
        state.recent = true;
        auth.loginInPopup.mockRejectedValue(new PersonMismatch());
        const session = createSession(auth, () => '/');
        await expect(session.renew()).rejects.toBeInstanceOf(LoginLoop);
        expect(auth.startPageLogin).not.toHaveBeenCalled();
        expect(session.loginLoop.value).toBe(true);
    });

    it('two calls failing with token-expired at once share one popup and are each resent once', async () => {
        const { auth } = fakeAuth();
        let finish!: () => void;
        auth.loginInPopup.mockImplementation(() => new Promise<undefined>((r) => (finish = () => r(undefined))));
        const a = vi.fn().mockRejectedValueOnce(problem('token-expired')).mockResolvedValueOnce('a');
        const b = vi.fn().mockRejectedValueOnce(problem('token-expired')).mockResolvedValueOnce('b');
        const session = createSession(auth, () => '/');
        const pa = session.call(a);
        const pb = session.call(b);
        await flush();
        finish();
        expect(await Promise.all([pa, pb])).toEqual(['a', 'b']);
        expect(auth.loginInPopup).toHaveBeenCalledOnce();
        expect(a).toHaveBeenCalledTimes(2);
        expect(b).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['LoginUnavailable', () => new LoginUnavailable()],
        ['oauth-code-invalid', () => problem('oauth-code-invalid', 400)],
    ])('a renewal failing with %s is passed on without resending', async (_name, make) => {
        const { auth } = fakeAuth();
        const error = make();
        auth.loginInPopup.mockRejectedValue(error);
        const fn = vi.fn().mockRejectedValue(problem('token-expired'));
        await expect(createSession(auth, () => '/').call(fn)).rejects.toBe(error);
        expect(fn).toHaveBeenCalledOnce();
        expect(auth.startPageLogin).not.toHaveBeenCalled();
    });

    it('forgets unsaved input once its form stops tracking it', async () => {
        const { auth } = fakeAuth();
        const session = createSession(auth, () => '/');
        const stop = session.trackUnsaved(() => true);
        stop();
        void session.call(() => Promise.reject(problem('invalid-token')));
        await flush();
        expect(auth.startPageLogin).toHaveBeenCalledOnce();
        expect(session.needsRenewal.value).toBe(false);
    });

    it('asks the unsaved-input check at the time of the failure', async () => {
        const { auth } = fakeAuth();
        const session = createSession(auth, () => '/');
        let dirty = false;
        session.trackUnsaved(() => dirty);
        dirty = true;
        await expect(session.call(() => Promise.reject(problem('invalid-token')))).rejects.toBeInstanceOf(BackendProblem);
        expect(auth.startPageLogin).not.toHaveBeenCalled();
    });
});

describe('useSession', () => {
    it('returns the provided session', () => {
        const { auth } = fakeAuth();
        const session = createSession(auth, () => '/');
        let seen: unknown;
        mount(
            defineComponent({
                setup() {
                    seen = useSession();
                    return () => h('div');
                },
            }),
            { global: { provide: { [SESSION_KEY as symbol]: session } } },
        );
        expect(seen).toBe(session);
    });

    it('fails loudly when no session is provided', () => {
        const Comp = defineComponent({
            setup() {
                useSession();
                return () => h('div');
            },
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(() => mount(Comp)).toThrow(/session/i);
        warn.mockRestore();
    });
});

describe('with a real Auth', () => {
    const ORIGIN = 'https://ct.example.org';
    const BACKEND = 'https://pw.example.org';
    const NOW = 1_800_000_000_000;
    const TOKEN = `${btoa('{}')}.${btoa(JSON.stringify({ sub: '1' })).replace(/=+$/, '')}.c2ln`;
    const RESULT: LoginResult = { accessToken: TOKEN, expiresIn: 900, admin: true, version: '0.1.7' };
    const RECORD = JSON.stringify({ accessToken: TOKEN, expiresAt: NOW + 600_000, admin: true, version: '0.1.7', backend: `${BACKEND}/v1`, person: 1 });

    function env() {
        const map = new Map<string, string>();
        const listeners = new Set<(e: MessageLike) => void>();
        const timers = new Set<() => void>();
        const popups: (PopupLike & { closed: boolean; urls: string[] })[] = [];
        const now = { value: NOW };
        const e: AuthEnv = {
            origin: ORIGIN,
            instanceBaseUrl: ORIGIN,
            redirectPath: '/ccm/ctpassstore/auth/callback',
            storage: () => ({
                getItem: (k) => map.get(k) ?? null,
                setItem: (k, v) => void map.set(k, v),
                removeItem: (k) => void map.delete(k),
            }),
            assign: () => undefined,
            open: () => {
                const popup = {
                    closed: false,
                    urls: [] as string[],
                    close() {
                        popup.closed = true;
                    },
                    location: { replace: (u: string) => void popup.urls.push(u) },
                };
                popups.push(popup);
                return popup;
            },
            listen: (fn) => {
                listeners.add(fn);
                return () => listeners.delete(fn);
            },
            every: (_ms, fn) => {
                timers.add(fn);
                return () => timers.delete(fn);
            },
            now: () => now.value,
        };
        return { e, map, listeners, timers, popups, now, tick: () => [...timers].forEach((fn) => fn()) };
    }
    const backend = () => ({ login: vi.fn(async () => RESULT) }) as unknown as BackendApi;

    it('takes role and version once the stored token becomes usable by configure() and bindPerson()', () => {
        const { e, map } = env();
        map.set(TOKEN_KEY, RECORD);
        const auth = new Auth(backend, e);
        const session = createSession(auth, () => '/');
        expect(session.admin.value).toBe(false);
        expect(session.backendVersion.value).toBeNull();
        auth.configure({ backendUrl: BACKEND, clientId: 'c' });
        expect(session.admin.value).toBe(false);
        auth.bindPerson(1);
        expect(session.admin.value).toBe(true);
        expect(session.backendVersion.value).toBe('0.1.7');
    });

    it('takes role and version from a page-login callback', async () => {
        const { e, map } = env();
        const auth = new Auth(backend, e);
        const session = createSession(auth, () => '/');
        map.set(LOGIN_KEY, JSON.stringify({ state: 's'.repeat(43), verifier: 'v'.repeat(43), returnPath: '/', backendUrl: BACKEND }));
        auth.configure({ backendUrl: BACKEND, clientId: 'c' });
        await auth.completePageLogin({ code: 'c', state: 's'.repeat(43) });
        auth.bindPerson(1);
        expect(session.admin.value).toBe(true);
        expect(session.backendVersion.value).toBe('0.1.7');
    });

    it('keeps the last role when the token is dropped (the frame stays until the renewal)', () => {
        const { e, map } = env();
        map.set(TOKEN_KEY, RECORD);
        const auth = new Auth(backend, e);
        auth.configure({ backendUrl: BACKEND, clientId: 'c' });
        auth.bindPerson(1);
        const session = createSession(auth, () => '/');
        auth.clear();
        expect(session.admin.value).toBe(true);
    });

    it('resets role and version when configure() switches to another backend', () => {
        const { e, map } = env();
        map.set(TOKEN_KEY, RECORD);
        const auth = new Auth(backend, e);
        auth.configure({ backendUrl: BACKEND, clientId: 'c' });
        auth.bindPerson(1);
        const session = createSession(auth, () => '/');
        expect(session.admin.value).toBe(true);
        auth.configure({ backendUrl: 'https://other.example.org', clientId: 'c' });
        expect(session.admin.value).toBe(false);
        expect(session.backendVersion.value).toBeNull();
    });

    it('resets role and version when another person is bound', () => {
        const { e, map } = env();
        map.set(TOKEN_KEY, RECORD);
        const auth = new Auth(backend, e);
        auth.configure({ backendUrl: BACKEND, clientId: 'c' });
        auth.bindPerson(1);
        const session = createSession(auth, () => '/');
        auth.bindPerson(2);
        expect(session.admin.value).toBe(false);
        expect(session.backendVersion.value).toBeNull();
    });

    it('after a popup that timed out, a later renew() starts a fresh attempt', async () => {
        const { e, popups, now, tick, listeners } = env();
        const auth = new Auth(backend, e);
        auth.configure({ backendUrl: BACKEND, clientId: 'c' });
        auth.bindPerson(1);
        const session = createSession(auth, () => '/');
        const first = session.renew();
        await vi.waitFor(() => expect(popups[0]?.urls).toHaveLength(1));
        now.value += 5 * 60_000;
        tick();
        await expect(first).rejects.toBeInstanceOf(PopupClosed);
        expect(popups[0]!.closed).toBe(true);
        expect(session.needsRenewal.value).toBe(true);

        const second = session.renew();
        await vi.waitFor(() => expect(popups[1]?.urls).toHaveLength(1));
        const state = new URL(popups[1]!.urls[0]!).searchParams.get('state');
        [...listeners].forEach((l) => l({ origin: ORIGIN, source: popups[1], data: { type: POPUP_MESSAGE, code: 'c', state } }));
        await second;
        expect(session.needsRenewal.value).toBe(false);
        expect(session.admin.value).toBe(true);
    });
});
