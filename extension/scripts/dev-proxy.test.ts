// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import config, { appConfig } from '../vite.config';
import { devProxy, ENV_PREFIX, loopbackServerHost, proxyRefusal, realModeGuard } from './dev-proxy';

/** Invented values only; the real `.env` is never read by these tests. */
const TOKEN = 'invented-login-token-for-the-test';
const BASE = 'https://example.church.tools';
const OWN = { host: 'localhost:5173' };

const rule = () => devProxy('real', { CT_BASE_URL: BASE, CT_LOGIN_TOKEN: TOKEN })!['/api']!;

/** What http-proxy hands to `proxyReq` listeners: the outgoing request. */
function outgoing(headers: Record<string, string>) {
    const set = new Map(Object.entries(headers));
    return {
        setHeader: vi.fn((k: string, v: string) => void set.set(k.toLowerCase(), v)),
        removeHeader: vi.fn((k: string) => void set.delete(k.toLowerCase())),
        destroy: vi.fn(),
        headers: set,
    };
}

/** Runs the rule's `proxyReq` handler as http-proxy would for an incoming request with these headers. */
function forward(incoming: Record<string, string>) {
    const proxy = new EventEmitter();
    rule().configure!(proxy as never, {} as never);
    const out = outgoing({ cookie: 'ct_session=abc', origin: incoming.origin ?? '', ...incoming });
    proxy.emit('proxyReq', out, { headers: incoming });
    return out;
}

describe('devProxy', () => {
    it('is off in every mode but real', () => {
        for (const mode of ['development', 'production', 'test', 'Real']) {
            expect(devProxy(mode, { CT_BASE_URL: BASE, CT_LOGIN_TOKEN: TOKEN }), mode).toBeUndefined();
        }
    });

    it('forwards /api to the instance origin in real mode, without a static token header', () => {
        const r = devProxy('real', { CT_BASE_URL: `${BASE}/`, CT_LOGIN_TOKEN: TOKEN })!['/api']!;
        expect(r.target).toBe(BASE);
        expect(r.changeOrigin).toBe(true);
        // The token is added per request, only after the same-origin check (never as a static `headers` option).
        expect(r.headers).toBeUndefined();
    });

    it.each([
        ['missing', undefined],
        ['empty', ''],
        ['http', 'http://example.church.tools'],
        ['credentials', 'https://user:pw@example.church.tools'],
        ['user name only', 'https://user@example.church.tools'],
        ['password only', 'https://:pw@example.church.tools'],
        ['not a URL', 'example.church.tools'],
    ])('refuses real mode with a %s CT_BASE_URL', (_case, url) => {
        expect(() => devProxy('real', { CT_BASE_URL: url, CT_LOGIN_TOKEN: TOKEN })).toThrow(/CT_BASE_URL/);
    });

    it('refuses real mode without a login token', () => {
        expect(() => devProxy('real', { CT_BASE_URL: BASE })).toThrow(/CT_LOGIN_TOKEN/);
        expect(() => devProxy('real', { CT_BASE_URL: BASE, CT_LOGIN_TOKEN: ' ' })).toThrow(/CT_LOGIN_TOKEN/);
    });

    const message = (env: Record<string, string | undefined>): string => {
        try {
            devProxy('real', env);
        } catch (error) {
            return String(error);
        }
        return '';
    };

    it.each([
        ['credentials in the address', { CT_BASE_URL: `https://u:${TOKEN}@example.church.tools`, CT_LOGIN_TOKEN: TOKEN }, /CT_BASE_URL/],
        ['an unparsable address', { CT_BASE_URL: `https://u:${TOKEN}@bad host`, CT_LOGIN_TOKEN: TOKEN }, /CT_BASE_URL/],
        ['a missing token', { CT_BASE_URL: `https://${TOKEN}.church.tools`, CT_LOGIN_TOKEN: '' }, /CT_LOGIN_TOKEN/],
    ])('never repeats the values in its error (%s)', (_case, env, expected) => {
        const text = message(env);
        expect(text).toMatch(expected);
        expect(text).not.toContain(TOKEN);
    });
});

describe('the proxy refuses requests that are not from the dev server page', () => {
    it.each([
        ['same-origin fetch', { ...OWN, 'sec-fetch-site': 'same-origin', origin: 'http://localhost:5173' }],
        ['same-origin GET without Origin', { ...OWN, 'sec-fetch-site': 'same-origin' }],
        ['no fetch metadata at all (curl on this machine)', { ...OWN }],
        ['127.0.0.1', { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' }],
    ])('passes %s', (_case, headers) => {
        expect(proxyRefusal(headers)).toBeNull();
        expect(rule().bypass!({ headers } as never, undefined, {} as never)).toBeUndefined();
    });

    it.each([
        ['cross-site', { ...OWN, 'sec-fetch-site': 'cross-site' }],
        ['same-site', { ...OWN, 'sec-fetch-site': 'same-site' }],
        ['a direct navigation', { ...OWN, 'sec-fetch-site': 'none' }],
        ['another origin', { ...OWN, origin: 'https://evil.example' }],
        ['another port on localhost', { ...OWN, origin: 'http://localhost:6000' }],
        ['Origin null', { ...OWN, origin: 'null' }],
        ['a non-loopback host (DNS rebinding)', { host: 'evil.example:5173', origin: 'http://evil.example:5173', 'sec-fetch-site': 'same-origin' }],
        ['a look-alike host', { host: 'localhost.evil.example:5173', 'sec-fetch-site': 'same-origin' }],
        ['a host with a path', { host: 'localhost:5173/x', 'sec-fetch-site': 'same-origin' }],
        ['a host with user info', { host: 'evil.example@localhost', 'sec-fetch-site': 'same-origin' }],
        ['no host', {}],
    ])('refuses %s (404, before forwarding)', (_case, headers) => {
        expect(proxyRefusal(headers as Record<string, string>)).not.toBeNull();
        expect(rule().bypass!({ headers } as never, undefined, {} as never)).toBe(false);
    });

    it('adds the token only for a same-origin request, and drops cookie and origin', () => {
        const out = forward({ ...OWN, 'sec-fetch-site': 'same-origin', origin: 'http://localhost:5173' });
        expect(out.setHeader).toHaveBeenCalledWith('Authorization', `Login ${TOKEN}`);
        expect(out.headers.has('cookie')).toBe(false);
        expect(out.headers.has('origin')).toBe(false);
        expect(out.destroy).not.toHaveBeenCalled();
    });

    it('never adds the token to a refused request, even if it got past the bypass', () => {
        const out = forward({ ...OWN, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
        expect(out.setHeader).not.toHaveBeenCalled();
        expect([...out.headers.values()].join(' ')).not.toContain(TOKEN);
        expect(out.destroy).toHaveBeenCalled();
    });
});

describe('real mode only on a loopback dev server', () => {
    it.each([
        [undefined, true],
        ['localhost', true],
        ['127.0.0.1', true],
        ['::1', true],
        [true, false],
        ['0.0.0.0', false],
        ['::', false],
        ['192.168.1.20', false],
        ['my-laptop.local', false],
    ] as const)('server.host %s → %s', (host, ok) => {
        expect(loopbackServerHost(host)).toBe(ok);
    });

    it('the guard plugin stops the dev server on another host, without naming values', () => {
        const guard = realModeGuard();
        const start = (host: string | boolean | undefined) => () => (guard.configureServer as (s: unknown) => void)({ config: { server: { host } } });
        expect(start('0.0.0.0')).toThrow(/--mode real.*loopback/);
        expect(start(true)).toThrow(/--mode real.*loopback/);
        expect(start(undefined)).not.toThrow();
    });
});

describe('vite.config', () => {
    const dirs: string[] = [];
    afterEach(() => {
        while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    });
    /** An env folder with invented values (or none), so the real `.env` is never read. */
    const envDir = (content?: string): string => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-env-'));
        dirs.push(dir);
        if (content !== undefined) fs.writeFileSync(path.join(dir, '.env'), content, { mode: 0o600 });
        return dir;
    };
    type Resolved = { envPrefix?: string; server?: { proxy?: Record<string, unknown> }; preview?: { proxy?: unknown }; plugins?: unknown[] };
    const resolve = (env: { mode: string; command: 'build' | 'serve'; isPreview?: boolean }, dir: string) => appConfig(env, dir) as Resolved;
    const pluginNames = (r: Resolved) => (r.plugins ?? []).flat().map((p) => (p as { name?: string }).name);

    it('the default export is the app config', () => {
        expect(typeof config).toBe('function');
    });

    it('exposes no VITE_ variables to the app (an old .env with VITE_* secrets cannot reach the bundle)', () => {
        const resolved = resolve({ mode: 'production', command: 'build' }, envDir());
        expect(ENV_PREFIX).not.toMatch(/^VITE_/);
        expect(resolved.envPrefix).toBe(ENV_PREFIX);
        expect(resolved.server?.proxy).toBeUndefined();
    });

    it('builds in mode real without the proxy and without reading CT_* (the proxy is for the dev server only)', () => {
        expect(resolve({ mode: 'real', command: 'build' }, envDir('CT_BASE_URL=nonsense\n')).server?.proxy).toBeUndefined();
    });

    it('gives vite preview no proxy in mode real (preview serves a build; it reads no CT_*)', () => {
        const resolved = resolve({ mode: 'real', command: 'serve', isPreview: true }, envDir('CT_BASE_URL=nonsense\n'));
        expect(resolved.server?.proxy).toBeUndefined();
        expect(resolved.preview?.proxy).toBeUndefined();
    });

    it('the dev server in mode real gets the /api proxy and the loopback guard', () => {
        const resolved = resolve({ mode: 'real', command: 'serve', isPreview: false }, envDir(`CT_BASE_URL=${BASE}\nCT_LOGIN_TOKEN=${TOKEN}\n`));
        expect(Object.keys(resolved.server?.proxy ?? {})).toEqual(['/api']);
        expect(pluginNames(resolved)).toContain('cps-real-mode-guard');
    });

    it('the dev server in mode real fails without CT_* values', () => {
        expect(() => resolve({ mode: 'real', command: 'serve', isPreview: false }, envDir())).toThrow(/CT_BASE_URL/);
    });

    it('the demo dev server has neither proxy nor guard', () => {
        const resolved = resolve({ mode: 'development', command: 'serve', isPreview: false }, envDir(`CT_BASE_URL=${BASE}\nCT_LOGIN_TOKEN=${TOKEN}\n`));
        expect(resolved.server?.proxy).toBeUndefined();
        expect(pluginNames(resolved)).not.toContain('cps-real-mode-guard');
    });
});
