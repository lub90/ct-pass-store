/** The backend factory of the app: the token is bound to the address each request goes to (security review F1). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Auth, LoginUnavailable, PopupBlocked, TOKEN_KEY, type AuthEnv } from '../backend/auth';
import { backendFor, createServices } from './services';

const BACKEND = 'https://pw.example';
const NOW = 1_800_000_000_000;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256' })}.${b64({ sub: '1' })}.c2ln`;

function auth(): Auth {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    storage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: TOKEN, expiresAt: NOW + 600_000, admin: false, version: '0.1.0', backend: `${BACKEND}/v1`, person: 1 }));
    const env = { origin: 'https://ct.example', instanceBaseUrl: 'https://ct.example', redirectPath: '/x', storage: () => storage, now: () => NOW } as unknown as AuthEnv;
    const a = new Auth(() => ({ login: vi.fn() }), env);
    a.configure({ backendUrl: BACKEND, clientId: 'c' });
    a.bindPerson(1);
    return a;
}

function stubFetch() {
    const seen: { url: string; authorization: string | undefined }[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
            seen.push({ url, authorization: (init.headers as Record<string, string>).Authorization });
            return new Response(JSON.stringify({ secondaryPwd: 'x' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }),
    );
    return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('backendFor', () => {
    it('sends the token to the configured backend', async () => {
        const seen = stubFetch();
        await backendFor(auth())(`${BACKEND}/`).getEntry(1);
        expect(seen).toEqual([{ url: `${BACKEND}/v1/entries/1`, authorization: `Bearer ${TOKEN}` }]);
    });

    it('never sends the token to another address', async () => {
        const seen = stubFetch();
        await backendFor(auth())('https://evil.example').getEntry(1);
        expect(seen).toEqual([{ url: 'https://evil.example/v1/entries/1', authorization: undefined }]);
    });
});

describe('createServices (the wiring the app runs with)', () => {
    afterEach(() => window.sessionStorage.clear());

    it('its backend factory sends the token only to the configured backend', async () => {
        const record = { accessToken: TOKEN, expiresAt: Date.now() + 600_000, admin: false, version: '0.1.0', backend: `${BACKEND}/v1`, person: 1 };
        window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(record));
        const services = createServices('de');
        services.auth.configure({ backendUrl: BACKEND, clientId: 'c' });
        services.auth.bindPerson(1);
        const seen = stubFetch();
        await services.backend('https://evil.example').getEntry(1);
        await services.backend(BACKEND).getEntry(1);
        expect(seen).toEqual([
            { url: 'https://evil.example/v1/entries/1', authorization: undefined },
            { url: `${BACKEND}/v1/entries/1`, authorization: `Bearer ${TOKEN}` },
        ]);
    });

    it('without a backend login (the dev server in real mode) refuses to leave the page instead of opening a 404', async () => {
        // A navigation would leave startPageLogin pending forever; the rejection proves the page stays.
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        try {
            const services = createServices('de', { backendLogin: false });
            services.auth.configure({ backendUrl: BACKEND, clientId: 'c' });
            services.auth.bindPerson(1);
            await expect(services.auth.startPageLogin('/')).rejects.toBeInstanceOf(LoginUnavailable);
            await expect(services.auth.loginInPopup()).rejects.toBeInstanceOf(PopupBlocked);
            expect(open).not.toHaveBeenCalled();
        } finally {
            open.mockRestore();
        }
    });
});
