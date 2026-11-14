/* eslint-disable vue/one-component-per-file -- small probe components that call useSession() */
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { PopupBlocked, PopupClosed } from '../backend/auth';
import { BackendProblem } from '../backend/problems';
import { RENEW_BEFORE_MS, SESSION_KEY, createSession, useSession, type SessionAuth } from './useSession';

function fakeAuth(options: { expiresInMs?: number; admin?: boolean; version?: string } = {}) {
    const state = {
        expiresInMs: options.expiresInMs ?? 600_000,
        info: { admin: options.admin ?? false, version: options.version ?? '0.1.0' } as { admin: boolean; version: string } | null,
    };
    const auth = {
        loginInPopup: vi.fn(async () => undefined),
        startPageLogin: vi.fn((path: string) => new Promise<never>(() => void path)),
        clear: vi.fn(() => undefined),
        info: vi.fn(() => state.info),
        expiresInMs: vi.fn(() => state.expiresInMs),
    } satisfies SessionAuth;
    return { auth, state };
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

describe('ensureFresh', () => {
    it.each([
        [RENEW_BEFORE_MS + 1_000, false],
        [RENEW_BEFORE_MS + 1, false],
        [RENEW_BEFORE_MS, true],
        [RENEW_BEFORE_MS - 1, true],
        [0, true],
    ])('with %i ms left renews: %s', async (left, renews) => {
        const { auth } = fakeAuth({ expiresInMs: left });
        await createSession(auth, () => '/').ensureFresh();
        expect(auth.loginInPopup).toHaveBeenCalledTimes(renews ? 1 : 0);
    });

    it('is 120 seconds', () => {
        expect(RENEW_BEFORE_MS).toBe(120_000);
    });

    it('takes role and version from the renewed token', async () => {
        const { auth, state } = fakeAuth({ expiresInMs: 0 });
        const session = createSession(auth, () => '/');
        auth.loginInPopup.mockImplementation(async () => {
            state.info = { admin: true, version: '0.1.9' };
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
        const typed = { password: 'Typed-1!' };
        const fn = vi.fn(async () => {
            throw problem('token-expired');
        });
        const session = createSession(auth, () => '/');
        await expect(session.call(fn)).rejects.toBeInstanceOf(PopupBlocked);
        expect(fn).toHaveBeenCalledOnce();
        expect(session.needsRenewal.value).toBe(true);
        expect(session.admin.value).toBe(true);
        expect(typed.password).toBe('Typed-1!');
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
