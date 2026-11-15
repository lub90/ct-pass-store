// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sandboxChildEnv, sandboxOverrideEnv, sweepStaleDirs } from './backend-sandbox';
import { Cleanup } from './cleanup';
import { CtSession, ctApiFor, retryAfterSeconds, scrubAxiosError } from './ct-session';
import { record } from './record';
import { redactBody } from './redact';
import type { ContractEnv } from './setup';

const TOKEN = 'dummy-login-token-QUJDREVGR0hJSktMTU5PUFFSU1RVVld';
const env: ContractEnv = {
    apiUrl: 'https://test.church.tools/api',
    root: 'https://test.church.tools',
    host: 'test.church.tools',
    apiToken: TOKEN,
    admin: { id: 1, username: 'admin', pwd: 'pw' },
    normal: { id: 2, username: 'normal', pwd: 'pw' },
    persons: { active: 3, archived: 4, deleted: 5 },
};

describe('redactBody', () => {
    it('blanks secret keys at any depth, in any case, inside arrays', () => {
        const body = JSON.stringify({ clientSecret: 'a', data: [{ client_secret: 'b', PASSWORD: 'c', primaryPwd: 'd', code: 'e', apiKey: 'f', sessionId: 'g', jwt: 'h', csrf: 'i', cookie: 'j', Authorization: 'k', ok: 'kept' }] });
        expect(JSON.parse(redactBody(body))).toEqual({
            clientSecret: '…',
            data: [{ client_secret: '…', PASSWORD: '…', primaryPwd: '…', code: '…', apiKey: '…', sessionId: '…', jwt: '…', csrf: '…', cookie: '…', Authorization: '…', ok: 'kept' }],
        });
    });

    it('cuts the result at 300 characters', () => {
        expect(redactBody(JSON.stringify({ a: 'x'.repeat(1000) }))).toHaveLength(300);
    });

    it('shows only a placeholder for a body that is not JSON or a JSON scalar', () => {
        expect(redactBody('<html>secret-page</html>')).toBe('<non-JSON body, 24 characters>');
        expect(redactBody('"secret-string"')).toBe('<JSON scalar, 15 characters>');
    });
});

describe('record', () => {
    let dir: string;
    beforeEach(() => {
        dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'contract-record-')), 'fixtures');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    });
    const data = { firstName: 'Anna', url: 'https://test.church.tools/api/persons/2', accessToken: 'abc' };

    it('writes nothing unless CT_CONTRACT_RECORD is exactly 1', () => {
        for (const value of [undefined, 'true', '0', 'yes']) {
            if (value === undefined) vi.stubEnv('CT_CONTRACT_RECORD', undefined);
            else vi.stubEnv('CT_CONTRACT_RECORD', value);
            record(env, 'x', data, dir);
            expect(fs.existsSync(dir), String(value)).toBe(false);
        }
    });

    it('with 1 writes the sanitized answer, file 600 and folder 700', () => {
        vi.stubEnv('CT_CONTRACT_RECORD', '1');
        record(env, 'x', data, dir);
        const file = path.join(dir, 'x.json');
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ firstName: '<name>', url: 'https://ct.example/api/persons/2', accessToken: '<redacted>' });
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    });

    it('tightens an existing folder and file to 700 and 600', () => {
        vi.stubEnv('CT_CONTRACT_RECORD', '1');
        fs.mkdirSync(dir, { mode: 0o755 });
        fs.chmodSync(dir, 0o755);
        const file = path.join(dir, 'x.json');
        fs.writeFileSync(file, '{}');
        fs.chmodSync(file, 0o644);
        record(env, 'x', data, dir);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    });
});

describe('Cleanup', () => {
    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it('runs the steps last in, first out', async () => {
        const order: string[] = [];
        const c = new Cleanup();
        for (const s of ['a', 'b', 'c']) c.add(s, async () => void order.push(s));
        await c.runAll();
        expect(order).toEqual(['c', 'b', 'a']);
        expect(c.done).toEqual(['c', 'b', 'a']);
    });

    it('runs every step after a failure and rejects naming every failed one', async () => {
        const order: string[] = [];
        const c = new Cleanup();
        c.add('first', async () => void order.push('first'));
        c.add('second', async () => {
            throw new Error('boom 2');
        });
        c.add('third', async () => {
            order.push('third');
            throw new Error('boom 3');
        });
        const error = await c.runAll().then(
            () => null,
            (e: unknown) => e as Error,
        );
        expect(order).toEqual(['third', 'first']);
        expect(error?.message).toMatch(/second: boom 2/);
        expect(error?.message).toMatch(/third: boom 3/);
        expect(error?.message).toMatch(/by hand/);
        expect(c.done).toEqual(['first']);
    });

    it('resolves for no steps and repeats nothing on a second run', async () => {
        const c = new Cleanup();
        await expect(c.runAll()).resolves.toBeUndefined();
        const run = vi.fn(async () => undefined);
        c.add('once', run);
        await c.runAll();
        await c.runAll();
        expect(run).toHaveBeenCalledTimes(1);
    });
});

describe('CtSession', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('refuses any address outside the test instance, before a request is sent', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const session = new CtSession(env, TOKEN);
        for (const url of ['https://evil.example/api/whoami', 'https://test.church.tools.evil.example/api', 'http://test.church.tools/api/whoami']) {
            await expect(session.request('GET', url), url).rejects.toThrow(/only talks to the test instance/);
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it('sends the login token and the session cookies to the instance', async () => {
        const fetch = vi.fn(async () => new Response('{"data":1}', { headers: { 'Set-Cookie': 'ChurchTools_x=1; path=/' } }));
        vi.stubGlobal('fetch', fetch);
        const session = new CtSession(env, TOKEN);
        await session.request('GET', '/whoami');
        await session.request('GET', '/whoami');
        const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
        expect(url).toBe('https://test.church.tools/api/whoami');
        expect(init.headers).toMatchObject({ Authorization: `Login ${TOKEN}`, Cookie: 'ChurchTools_x=1' });
        expect(init.redirect).toBe('manual');
    });

    it('waits out a rate-limited login (Retry-After, at most 90 s) and tries again, twice at most', async () => {
        const answers = [new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }), new Response('{}', { status: 429 }), new Response('{"data":{"status":"success"}}')];
        vi.stubGlobal('fetch', vi.fn(async () => answers.shift()));
        const waits: number[] = [];
        await new CtSession(env).login(env.normal, async (s) => void waits.push(s));
        expect(waits).toEqual([7, 60]);

        const huge = [new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } }), new Response('{"data":{"status":"success"}}')];
        vi.stubGlobal('fetch', vi.fn(async () => huge.shift()));
        waits.length = 0;
        await new CtSession(env).login(env.normal, async (s) => void waits.push(s));
        expect(waits).toEqual([90]);

        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })));
        waits.length = 0;
        await expect(new CtSession(env).login(env.normal, async (s) => void waits.push(s))).rejects.toThrow('Login of fixture person 2 answered 429');
        expect(waits).toEqual([1, 1]);
    });

    it('does not retry a refused login', async () => {
        const fetch = vi.fn(async () => new Response('{}', { status: 400 }));
        vi.stubGlobal('fetch', fetch);
        const wait = vi.fn(async () => undefined);
        await expect(new CtSession(env).login(env.normal, wait)).rejects.toThrow('answered 400');
        expect(wait).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('the test ChurchTools client never carries the token in an error', () => {
    const axiosError = (response?: object) =>
        Object.assign(new Error('connect ECONNREFUSED'), {
            isAxiosError: true,
            code: 'ECONNREFUSED',
            config: { headers: { Authorization: `Login ${TOKEN}` }, url: '/whoami' },
            request: { _header: `GET /api/whoami\r\nAuthorization: Login ${TOKEN}` },
            response,
        });

    it('scrubAxiosError keeps only the code of a network error', () => {
        const scrubbed = scrubAxiosError(axiosError());
        expect(scrubbed).toBeInstanceOf(Error);
        expect((scrubbed as Error).message).toBe('ChurchTools network error ECONNREFUSED');
        expect(inspect(scrubbed, { depth: 10 })).not.toContain(TOKEN);
    });

    it('scrubAxiosError keeps status, headers and data of an HTTP error, without config or request', () => {
        const scrubbed = scrubAxiosError(
            axiosError({ status: 429, headers: { 'Retry-After': '5', 'set-cookie': [`ChurchTools_x=${TOKEN}`] }, data: { message: 'no' }, config: { headers: { Authorization: TOKEN } }, request: {} }),
        );
        expect(scrubbed).toEqual({ response: { status: 429, headers: { 'retry-after': '5' }, data: { message: 'no' } } });
        expect(inspect(scrubbed, { depth: 10 })).not.toContain(TOKEN);
    });

    it('scrubAxiosError reads retry-after from axios headers with get(), and keeps no headers without it', () => {
        const withGet = { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '7' : `ChurchTools_x=${TOKEN}`) };
        expect(scrubAxiosError(axiosError({ status: 429, headers: withGet, data: {} }))).toEqual({ response: { status: 429, headers: { 'retry-after': '7' }, data: {} } });
        expect(scrubAxiosError(axiosError({ status: 500, headers: { 'set-cookie': ['a=b'] }, data: {} }))).toEqual({ response: { status: 500, headers: {}, data: {} } });
    });

    it('a 429 through ctApiFor still gives the waiting time', async () => {
        const api = ctApiFor(env, { loginToken: TOKEN }, (config) =>
            Promise.reject(Object.assign(axiosError({ status: 429, headers: { 'retry-after': '120', 'set-cookie': ['a=b'] }, data: {}, config }), { config })),
        );
        expect(await api.whoami().catch((e: unknown) => e)).toMatchObject({ name: 'CtRateLimitedError', retryAfterMs: 120_000 });
    });

    it('a failing request through ctApiFor rejects without the token anywhere in the error', async () => {
        const api = ctApiFor(env, { loginToken: TOKEN }, (config) => Promise.reject(Object.assign(axiosError(), { config })));
        const error = await api.whoami().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect(inspect(error, { depth: 10 })).not.toContain(TOKEN);
        expect(String(error)).toMatch(/ChurchTools network error/);
    });

    it('an HTTP error through ctApiFor is still mapped to the layer\'s errors', async () => {
        const api = ctApiFor(env, { loginToken: TOKEN }, (config) => Promise.reject(Object.assign(axiosError({ status: 403, headers: {}, data: { message: 'Forbidden' }, config }), { config })));
        const error = await api.whoami().catch((e: unknown) => e);
        expect(error).toMatchObject({ name: 'CtForbiddenError' });
        expect(inspect(error, { depth: 10 })).not.toContain(TOKEN);
    });
});

describe('sweepStaleDirs', () => {
    let tmp: string;
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-sweep-'));
    });
    afterEach(() => {
        for (const d of fs.readdirSync(tmp, { recursive: true }) as string[]) fs.chmodSync(path.join(tmp, d), 0o700);
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('deletes the prefixed folders of this user, keeps others, and goes on past one it cannot delete', () => {
        for (const d of ['cps-backend-sandbox-a', 'cps-backend-sandbox-b', 'cps-backend-sandbox-locked', 'other-folder']) fs.mkdirSync(path.join(tmp, d));
        // A folder whose content can't be removed (its subfolder isn't writable).
        fs.mkdirSync(path.join(tmp, 'cps-backend-sandbox-locked/inner'));
        fs.writeFileSync(path.join(tmp, 'cps-backend-sandbox-locked/inner/f'), 'x');
        fs.chmodSync(path.join(tmp, 'cps-backend-sandbox-locked/inner'), 0o500);
        sweepStaleDirs(tmp, 'cps-backend-sandbox-', process.getuid!());
        expect(fs.readdirSync(tmp).sort()).toEqual(['cps-backend-sandbox-locked', 'other-folder']);
    });

    it('leaves folders of another user alone', () => {
        fs.mkdirSync(path.join(tmp, 'cps-backend-sandbox-a'));
        sweepStaleDirs(tmp, 'cps-backend-sandbox-', process.getuid!() + 1);
        expect(fs.readdirSync(tmp)).toEqual(['cps-backend-sandbox-a']);
    });

    it('keeps the folders of sandboxes this run still uses', () => {
        for (const d of ['cps-backend-sandbox-a', 'cps-backend-sandbox-b']) fs.mkdirSync(path.join(tmp, d));
        sweepStaleDirs(tmp, 'cps-backend-sandbox-', process.getuid!(), new Set([path.join(tmp, 'cps-backend-sandbox-b')]));
        expect(fs.readdirSync(tmp)).toEqual(['cps-backend-sandbox-b']);
    });
});

describe('sandboxOverrideEnv', () => {
    it('is empty without an override', () => {
        expect(sandboxOverrideEnv({})).toEqual({});
    });

    it('names exactly the two settings of the variant, the settings category and the admin group', () => {
        const variant = { requirePasswordForPasswordChange: true, allowCustomPassword: false, passwordLength: 64 } as never;
        expect(sandboxOverrideEnv({ settings: { variant, categoryId: 406 }, adminGroupId: 7 })).toEqual({
            CPS_SANDBOX_SETTINGS: '{"requirePasswordForPasswordChange":true,"allowCustomPassword":false}',
            CPS_SANDBOX_SETTINGS_CATEGORY_ID: '406',
            CPS_SANDBOX_ADMIN_GROUP_ID: '7',
        });
        expect(sandboxOverrideEnv({ settings: { variant: { requirePasswordForPasswordChange: false, allowCustomPassword: true }, categoryId: 1 } })).toEqual({
            CPS_SANDBOX_SETTINGS: '{"requirePasswordForPasswordChange":false,"allowCustomPassword":true}',
            CPS_SANDBOX_SETTINGS_CATEGORY_ID: '1',
        });
    });
});

describe('sandboxChildEnv', () => {
    it('gives the PHP process its configuration and its override, and nothing of the test process', () => {
        const options = { oauthClientId: 'cid', oauthClientSecret: 'csecret', settings: { variant: { requirePasswordForPasswordChange: true, allowCustomPassword: false }, categoryId: 406 }, adminGroupId: 7 };
        const child = sandboxChildEnv(env, options, '/tmp/x/cache', 'jwt');
        expect(child).toEqual({
            PATH: process.env.PATH,
            PHP_CLI_SERVER_WORKERS: '4',
            CPS_SANDBOX_BACKEND_DIR: expect.stringMatching(/backend$/),
            CPS_SANDBOX_CACHE_DIR: '/tmp/x/cache',
            CPS_SANDBOX_CT_API_URL: env.apiUrl,
            CPS_SANDBOX_CT_API_TOKEN: TOKEN,
            CPS_SANDBOX_CORS_ORIGIN: env.root,
            CPS_SANDBOX_OAUTH_CLIENT_ID: 'cid',
            CPS_SANDBOX_OAUTH_CLIENT_SECRET: 'csecret',
            CPS_SANDBOX_JWT_SECRET: 'jwt',
            ...sandboxOverrideEnv(options),
        });
        expect(child.CPS_SANDBOX_SETTINGS).toBe('{"requirePasswordForPasswordChange":true,"allowCustomPassword":false}');
        expect(child.CPS_SANDBOX_ADMIN_GROUP_ID).toBe('7');
    });
});

describe('retryAfterSeconds', () => {
    it('reads whole seconds (spaces around allowed), else 60, at most 90', () => {
        expect(retryAfterSeconds('7')).toBe(7);
        expect(retryAfterSeconds(' 7 ')).toBe(7);
        expect(retryAfterSeconds('0')).toBe(0);
        expect(retryAfterSeconds('7.5')).toBe(60);
        expect(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(60);
        expect(retryAfterSeconds('7a')).toBe(60);
        expect(retryAfterSeconds('a7')).toBe(60);
        expect(retryAfterSeconds(null)).toBe(60);
        expect(retryAfterSeconds('91')).toBe(90);
    });
});
