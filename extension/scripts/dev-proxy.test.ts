// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../vite.config';
import { devProxy, ENV_PREFIX } from './dev-proxy';

const TOKEN = 'invented-login-token-for-the-test';

describe('devProxy', () => {
    it('is off in every mode but real', () => {
        for (const mode of ['development', 'production', 'test', 'Real']) {
            expect(devProxy(mode, { CT_BASE_URL: 'https://example.church.tools', CT_LOGIN_TOKEN: TOKEN }), mode).toBeUndefined();
        }
    });

    it('forwards /api to the instance with the login token in real mode', () => {
        expect(devProxy('real', { CT_BASE_URL: 'https://example.church.tools/', CT_LOGIN_TOKEN: TOKEN })).toEqual({
            '/api': { target: 'https://example.church.tools', changeOrigin: true, headers: { Authorization: `Login ${TOKEN}` } },
        });
    });

    it.each([
        ['missing', undefined],
        ['empty', ''],
        ['http', 'http://example.church.tools'],
        ['credentials', 'https://user:pw@example.church.tools'],
        ['not a URL', 'example.church.tools'],
    ])('refuses real mode with a %s CT_BASE_URL', (_case, url) => {
        expect(() => devProxy('real', { CT_BASE_URL: url, CT_LOGIN_TOKEN: TOKEN })).toThrow(/CT_BASE_URL/);
    });

    it('refuses real mode without a login token and never names the values', () => {
        expect(() => devProxy('real', { CT_BASE_URL: 'https://example.church.tools' })).toThrow(/CT_LOGIN_TOKEN/);
        expect(() => devProxy('real', { CT_BASE_URL: 'https://example.church.tools', CT_LOGIN_TOKEN: ' ' })).toThrow(/CT_LOGIN_TOKEN/);
        let message = '';
        try {
            devProxy('real', { CT_BASE_URL: `https://u:${TOKEN}@example.church.tools`, CT_LOGIN_TOKEN: TOKEN });
        } catch (error) {
            message = String(error);
        }
        expect(message).toMatch(/CT_BASE_URL/);
        expect(message).not.toContain(TOKEN);
    });
});

describe('vite.config', () => {
    it('exposes no VITE_ variables to the app (an old .env with VITE_* secrets cannot reach the bundle)', async () => {
        const resolved = await (config as (env: { mode: string; command: 'build' }) => Promise<{ envPrefix?: string; server?: { proxy?: unknown } }> | { envPrefix?: string; server?: { proxy?: unknown } })({ mode: 'production', command: 'build' });
        expect(ENV_PREFIX).not.toMatch(/^VITE_/);
        expect(resolved.envPrefix).toBe(ENV_PREFIX);
        expect(resolved.server?.proxy).toBeUndefined();
    });

    it('builds in mode real without the proxy and without reading CT_* (the proxy is for the dev server only)', async () => {
        const resolved = await (config as (env: { mode: string; command: 'build' }) => { server?: { proxy?: unknown } })({ mode: 'real', command: 'build' });
        expect(resolved.server?.proxy).toBeUndefined();
    });

    it('gives vite preview no proxy in mode real (preview serves a build; it reads no CT_*)', async () => {
        const resolved = await (config as (env: { mode: string; command: 'serve'; isPreview: boolean }) => { server?: { proxy?: unknown }; preview?: { proxy?: unknown } })({
            mode: 'real',
            command: 'serve',
            isPreview: true,
        });
        expect(resolved.server?.proxy).toBeUndefined();
        expect(resolved.preview?.proxy).toBeUndefined();
    });
});
