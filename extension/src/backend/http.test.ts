import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendBase, createBackendApi, TIMEOUT_MS } from './api';
import { BackendConfigError, BackendProblem, BackendUnreachable, UnexpectedResponse } from './problems';

const TYPE = 'https://github.com/lub90/ct-pass-store/blob/main/backend/docs/problems.md';
const PROBLEM = 'application/problem+json';

const respond = (status: number, body: string | null, contentType?: string): Response =>
    new Response(status === 204 ? null : body, { status, headers: contentType ? { 'Content-Type': contentType } : {} });
const json = (status: number, body: unknown, contentType = 'application/json') => respond(status, JSON.stringify(body), contentType);
const problem = (status: number, slug: string, extra: object = {}) =>
    json(status, { type: `${TYPE}#${slug}`, title: 't', status, detail: 'd', ...extra }, PROBLEM);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const api = (token: string | null = 'tok-123', base = 'https://x.example/pw') => createBackendApi(base, () => token);
const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers) };
};

describe('backendBase', () => {
    it.each([
        ['https://x.example/pw/', 'https://x.example/pw/v1'],
        ['https://x.example/pw', 'https://x.example/pw/v1'],
        ['https://x.example', 'https://x.example/v1'],
        ['https://x.example/', 'https://x.example/v1'],
        ['https://x.example/pw///', 'https://x.example/pw/v1'],
        ['  https://x.example/pw/  ', 'https://x.example/pw/v1'],
        ['https://x.example:8443/a/b/', 'https://x.example:8443/a/b/v1'],
    ])('%s -> %s', (input, expected) => {
        expect(backendBase(input)).toBe(expected);
    });
});

describe('request building', () => {
    it('GET: URL, method, Bearer header, no body, no cookies, no caching', async () => {
        fetchMock.mockResolvedValue(json(200, { secondaryPwd: 'abc' }));
        await api('tok-123', 'https://x.example/pw/').getEntry(42);
        const { url, init, headers } = lastCall();
        expect(url).toBe('https://x.example/pw/v1/entries/42');
        expect(init.method).toBe('GET');
        expect(headers.get('Authorization')).toBe('Bearer tok-123');
        expect(headers.get('Accept')).toBe('application/json');
        expect(headers.has('Content-Type')).toBe(false);
        expect(init.body).toBeUndefined();
        expect(init.credentials).toBe('omit');
        expect(init.cache).toBe('no-store');
        expect(init.redirect).toBe('error');
    });

    it('reads the token per request', async () => {
        let token: string | null = 'first';
        const a = createBackendApi('https://x.example', () => token);
        fetchMock.mockImplementation(async () => json(200, { secondaryPwd: 'abc' }));
        await a.getEntry(1);
        expect(lastCall().headers.get('Authorization')).toBe('Bearer first');
        token = 'second';
        await a.getEntry(1);
        expect(lastCall().headers.get('Authorization')).toBe('Bearer second');
    });

    it('sends no Authorization header when token() is null', async () => {
        fetchMock.mockImplementation(async () => json(200, { secondaryPwd: 'abc' }));
        await api(null).getEntry(1);
        expect(lastCall().headers.has('Authorization')).toBe(false);
    });

    it('login never sends an Authorization header, even with a token', async () => {
        fetchMock.mockResolvedValue(json(200, { accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, admin: false, version: '1.0.0' }));
        await api('tok-123').login('c', 'v', 'https://ct.example/cb');
        const { url, init, headers } = lastCall();
        expect(url).toBe('https://x.example/pw/v1/auth/token');
        expect(init.method).toBe('POST');
        expect(headers.has('Authorization')).toBe(false);
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(JSON.parse(init.body as string)).toEqual({ code: 'c', codeVerifier: 'v', redirectUri: 'https://ct.example/cb' });
    });

    it('PUT sends only the given fields, an empty custom password included', async () => {
        fetchMock.mockImplementation(async () => respond(204, null));
        await api().putEntry(7, { secondaryPwd: '' });
        expect(JSON.parse(lastCall().init.body as string)).toEqual({ secondaryPwd: '' });
        await api().putEntry(7, { primaryPwd: 'p', secondaryPwd: 's' });
        expect(lastCall().init.method).toBe('PUT');
        expect(lastCall().url).toBe('https://x.example/pw/v1/entries/7');
        expect(JSON.parse(lastCall().init.body as string)).toEqual({ primaryPwd: 'p', secondaryPwd: 's' });
        fetchMock.mockImplementation(async () => json(200, { secondaryPwd: 'Gen3rated!pw' }));
        await api().putEntry(7, {});
        expect(lastCall().headers.get('Content-Type')).toBe('application/json');
        expect(JSON.parse(lastCall().init.body as string)).toEqual({});
    });

    it('PUT drops fields the backend does not know', async () => {
        fetchMock.mockImplementation(async () => respond(204, null));
        await api().putEntry(7, { secondaryPwd: 's', personId: 9 } as never);
        expect(JSON.parse(lastCall().init.body as string)).toEqual({ secondaryPwd: 's' });
    });

    it('DELETE sends the primary password only when given', async () => {
        fetchMock.mockResolvedValue(respond(204, null));
        await api().deleteEntry(7);
        expect(lastCall().init.method).toBe('DELETE');
        expect(lastCall().init.body).toBeUndefined();
        await api().deleteEntry(7, 'pw');
        expect(JSON.parse(lastCall().init.body as string)).toEqual({ primaryPwd: 'pw' });
    });

    it('selfTest asks for the write check only on request', async () => {
        fetchMock.mockImplementation(async () => json(200, { version: '1.0.0', summary: 's', tests: [] }));
        await api().selfTest();
        expect(lastCall().url).toBe('https://x.example/pw/v1/test');
        await api().selfTest(false);
        expect(lastCall().url).toBe('https://x.example/pw/v1/test');
        await api().selfTest(true);
        expect(lastCall().url).toBe('https://x.example/pw/v1/test?write=1');
    });

    it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '12' as unknown as number, '1/../2' as unknown as number])(
        'refuses the person id %s before any request',
        async (id) => {
            await expect(api().getEntry(id)).rejects.toThrow('Invalid person id');
            await expect(api().putEntry(id, {})).rejects.toThrow('Invalid person id');
            await expect(api().deleteEntry(id)).rejects.toThrow('Invalid person id');
            expect(fetchMock).not.toHaveBeenCalled();
        },
    );
});

describe('base URL', () => {
    const make = (url: string, options?: { allowLocalHttp?: boolean }) => () => createBackendApi(url, () => null, options);

    it.each([
        ['plain http', 'http://x.example/pw'],
        ['userinfo', 'https://user:pass@x.example/pw'],
        ['a user name only', 'https://user@x.example'],
        ['no URL at all', 'not a url'],
        ['an empty string', ''],
        ['another scheme', 'ftp://x.example'],
        ['a javascript URL', 'javascript:alert(1)'],
        ['http on a look-alike of localhost', 'http://localhost.evil.example'],
        ['http on a remote host', 'http://x.example'],
    ])('refuses %s before any request', async (_n, url) => {
        expect(make(url)).toThrow(BackendConfigError);
        expect(make(url, { allowLocalHttp: true })).toThrow(BackendConfigError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the config error does not echo the URL', () => {
        try {
            createBackendApi('https://user:topsecret@x.example', () => null);
            expect.unreachable();
        } catch (e) {
            expect((e as Error).message).not.toContain('topsecret');
        }
    });

    it('allows https, with a port and a path', () => {
        expect(make('https://x.example:8443/a/b/')).not.toThrow();
    });

    it('allows http only for localhost and 127.0.0.1 and only with the explicit option', () => {
        for (const url of ['http://localhost:8080', 'http://127.0.0.1/pw', 'http://localhost']) {
            expect(make(url), url).toThrow(BackendConfigError);
            expect(make(url, { allowLocalHttp: false }), url).toThrow(BackendConfigError);
            expect(make(url, { allowLocalHttp: true }), url).not.toThrow();
        }
        expect(make('https://localhost', { allowLocalHttp: true })).not.toThrow();
    });
});

describe('responses', () => {
    it('getEntry: 200 -> set, entry-not-found -> none; the ciphertext is not returned', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { secondaryPwd: 'Y2lwaGVy' }));
        expect(await api().getEntry(1)).toBe('set');
        fetchMock.mockResolvedValueOnce(problem(404, 'entry-not-found'));
        expect(await api().getEntry(1)).toBe('none');
    });

    it('getEntry: any other 404 is an error, not "no password"', async () => {
        for (const slug of ['not-found', 'person-not-found']) {
            fetchMock.mockResolvedValueOnce(problem(404, slug));
            await expect(api().getEntry(1)).rejects.toMatchObject({ slug, status: 404 });
        }
        fetchMock.mockResolvedValueOnce(respond(404, '<html>nope</html>', 'text/html'));
        await expect(api().getEntry(1)).rejects.toBeInstanceOf(UnexpectedResponse);
    });

    it('getEntry: "none" needs the slug entry-not-found AND status 404', async () => {
        fetchMock.mockResolvedValueOnce(problem(500, 'entry-not-found'));
        await expect(api().getEntry(1)).rejects.toMatchObject({ slug: 'entry-not-found', status: 500 });
        fetchMock.mockResolvedValueOnce(problem(500, 'internal-error'));
        await expect(api().getEntry(1)).rejects.toMatchObject({ slug: 'internal-error' });
        fetchMock.mockResolvedValueOnce(problem(404, 'entry-not-found'));
        expect(await api().getEntry(1)).toBe('none');
    });

    it('getEntry: only 200 is success (201 with a valid body is not)', async () => {
        fetchMock.mockResolvedValueOnce(json(201, { secondaryPwd: 'abc' }));
        await expect(api().getEntry(1)).rejects.toMatchObject({ name: 'UnexpectedResponse', status: 201 });
    });

    it.each([
        ['200 without secondaryPwd', () => json(200, {})],
        ['200 with a non-string secondaryPwd', () => json(200, { secondaryPwd: 5 })],
        ['204', () => respond(204, null)],
        ['200 array', () => json(200, [])],
        ['200 null', () => json(200, null)],
    ])('getEntry: %s is unexpected', async (_n, make) => {
        fetchMock.mockResolvedValueOnce(make());
        await expect(api().getEntry(1)).rejects.toBeInstanceOf(UnexpectedResponse);
    });

    it('putEntry: a custom password is stored only with 204', async () => {
        fetchMock.mockResolvedValueOnce(respond(204, null));
        expect(await api().putEntry(1, { secondaryPwd: 'x' })).toEqual({});
        // 200 with a valid body is the answer to "generate one", not to "store this one"
        fetchMock.mockResolvedValueOnce(json(200, { secondaryPwd: 'Gen3rated!pw' }));
        await expect(api().putEntry(1, { secondaryPwd: 'x' })).rejects.toBeInstanceOf(UnexpectedResponse);
        fetchMock.mockResolvedValueOnce(json(200, {}));
        await expect(api().putEntry(1, { secondaryPwd: '' })).rejects.toBeInstanceOf(UnexpectedResponse);
    });

    it('putEntry: with no custom password only a 200 with the generated one is success', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { secondaryPwd: 'Gen3rated!pw' }));
        expect(await api().putEntry(1, {})).toEqual({ generated: 'Gen3rated!pw' });
        fetchMock.mockResolvedValueOnce(json(200, { secondaryPwd: 'Gen3rated!pw' }));
        expect(await api().putEntry(1, { primaryPwd: 'p' })).toEqual({ generated: 'Gen3rated!pw' });
        fetchMock.mockResolvedValueOnce(respond(204, null));
        await expect(api().putEntry(1, {})).rejects.toMatchObject({ name: 'UnexpectedResponse', status: 204 });
    });

    it.each([
        ['200 without secondaryPwd', () => json(200, {})],
        ['200 empty secondaryPwd', () => json(200, { secondaryPwd: '' })],
        ['200 non-JSON', () => respond(200, 'ok', 'text/plain')],
        ['201', () => respond(201, '{"secondaryPwd":"x"}', 'application/json')],
    ])('putEntry: %s is unexpected', async (_n, make) => {
        fetchMock.mockResolvedValueOnce(make());
        await expect(api().putEntry(1, {})).rejects.toBeInstanceOf(UnexpectedResponse);
    });

    it('deleteEntry: 204 resolves, 200 is unexpected', async () => {
        fetchMock.mockResolvedValueOnce(respond(204, null));
        await expect(api().deleteEntry(1)).resolves.toBeUndefined();
        fetchMock.mockResolvedValueOnce(json(200, {}));
        await expect(api().deleteEntry(1)).rejects.toBeInstanceOf(UnexpectedResponse);
    });

    it('login: returns exactly the documented fields', async () => {
        fetchMock.mockResolvedValue(json(200, { accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900, admin: true, version: '1.2.3', extra: 1 }));
        expect(await api().login('c', 'v', 'r')).toEqual({ accessToken: 'jwt', expiresIn: 900, admin: true, version: '1.2.3' });
    });

    it.each([
        ['no accessToken', { tokenType: 'Bearer', expiresIn: 900, admin: false, version: '1.0.0' }],
        ['empty accessToken', { accessToken: '', tokenType: 'Bearer', expiresIn: 900, admin: false, version: '1.0.0' }],
        ['wrong tokenType', { accessToken: 'a', tokenType: 'MAC', expiresIn: 900, admin: false, version: '1.0.0' }],
        ['expiresIn a string', { accessToken: 'a', tokenType: 'Bearer', expiresIn: '900', admin: false, version: '1.0.0' }],
        ['expiresIn 1.5', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 1.5, admin: false, version: '1.0.0' }],
        ['expiresIn negative', { accessToken: 'a', tokenType: 'Bearer', expiresIn: -900, admin: false, version: '1.0.0' }],
        ['expiresIn over a day', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 86_401, admin: false, version: '1.0.0' }],
        ['empty version', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, admin: false, version: '' }],
        ['expiresIn zero', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 0, admin: false, version: '1.0.0' }],
        ['admin not a boolean', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, admin: 'true', version: '1.0.0' }],
        ['admin missing', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, version: '1.0.0' }],
        ['version missing', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, admin: false }],
    ])('login: %s is unexpected', async (_n, body) => {
        fetchMock.mockResolvedValueOnce(json(200, body));
        await expect(api().login('c', 'v', 'r')).rejects.toBeInstanceOf(UnexpectedResponse);
    });

    it('login: 201 with a valid body is not success', async () => {
        fetchMock.mockResolvedValueOnce(json(201, { accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, admin: false, version: '1.0.0' }));
        await expect(api().login('c', 'v', 'r')).rejects.toMatchObject({ name: 'UnexpectedResponse', status: 201 });
    });

    it('login: expiresIn of 1 and of 86400 are accepted', async () => {
        for (const expiresIn of [1, 86_400]) {
            fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'a', tokenType: 'Bearer', expiresIn, admin: false, version: '1.0.0' }));
            expect((await api().login('c', 'v', 'r')).expiresIn).toBe(expiresIn);
        }
    });

    it('selfTest: 200 and 207 both give the result; bad shapes are unexpected', async () => {
        const body = { version: '1.0.0', summary: '1 of 2', tests: [{ name: 'a', status: 'ok', message: 'm' }, { name: 'b', status: 'fail', message: 'm2' }] };
        fetchMock.mockResolvedValueOnce(json(200, { ...body, extra: 1, tests: body.tests.map((t) => ({ ...t, secret: 'x' })) }));
        const r = await api().selfTest();
        expect(r).toEqual(body);
        expect(Object.keys(r).sort()).toEqual(['summary', 'tests', 'version']);
        expect(Object.keys(r.tests[0]!).sort()).toEqual(['message', 'name', 'status']);
        fetchMock.mockResolvedValueOnce(json(207, body));
        expect(await api().selfTest()).toEqual(body);
        for (const status of [201, 206, 202]) {
            fetchMock.mockResolvedValueOnce(json(status, body));
            await expect(api().selfTest()).rejects.toMatchObject({ name: 'UnexpectedResponse', status });
        }
        // `undefined` is dropped by JSON.stringify: the member is missing
        const noVersion = { ...body, version: undefined };
        const noSummary = { ...body, summary: undefined };
        for (const bad of [noVersion, { ...body, version: 3 }, { ...body, version: '' }, noSummary, { ...body, summary: 1 }, { ...body, tests: [{ name: 'a', status: 'ok' }] }]) {
            fetchMock.mockResolvedValueOnce(json(200, bad));
            await expect(api().selfTest()).rejects.toBeInstanceOf(UnexpectedResponse);
        }
        fetchMock.mockResolvedValueOnce(json(200, { ...body, tests: 'x' }));
        await expect(api().selfTest()).rejects.toBeInstanceOf(UnexpectedResponse);
        fetchMock.mockResolvedValueOnce(json(200, { ...body, tests: [{ name: 'a', status: 'maybe', message: 'm' }] }));
        await expect(api().selfTest()).rejects.toBeInstanceOf(UnexpectedResponse);
    });
});

describe('problems', () => {
    it('password-invalid keeps violations', async () => {
        fetchMock.mockResolvedValue(problem(400, 'password-invalid', { violations: ['too-short', 'missing-digit'] }));
        const e = await api().putEntry(1, { secondaryPwd: 'a' }).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(BackendProblem);
        expect(e).toMatchObject({ slug: 'password-invalid', status: 400, violations: ['too-short', 'missing-digit'] });
    });

    it('retryAfter is parsed (too-many-attempts)', async () => {
        fetchMock.mockResolvedValue(problem(429, 'too-many-attempts', { retryAfter: 300 }));
        await expect(api().putEntry(1, {})).rejects.toMatchObject({ slug: 'too-many-attempts', status: 429, retryAfter: 300 });
    });

    it('a problem with a charset parameter and upper case is still a problem', async () => {
        fetchMock.mockResolvedValue(json(403, { type: `${TYPE}#forbidden` }, 'Application/Problem+JSON; charset=utf-8'));
        await expect(api().getEntry(1)).rejects.toMatchObject({ slug: 'forbidden', status: 403 });
    });

    it.each([
        ['a non-JSON body', () => respond(500, '<html>Server error</html>', 'text/html')],
        ['no content type', () => respond(502, 'bad gateway')],
        ['a problem content type with a non-JSON body', () => respond(500, 'not json', PROBLEM)],
        ['a problem content type with an empty body', () => respond(500, '', PROBLEM)],
        ['a problem body with application/json', () => json(400, { type: `${TYPE}#invalid-id` }, 'application/json')],
        ['a problem body with text/plain', () => json(400, { type: `${TYPE}#invalid-id` }, 'text/plain')],
        ['a problem type without "#"', () => json(400, { type: TYPE }, PROBLEM)],
        ['a problem body that is an array', () => json(400, [], PROBLEM)],
        ['a problem body without type', () => json(400, { title: 'x' }, PROBLEM)],
        ['a 3xx answer', () => respond(302, '', PROBLEM)],
        ['a 3xx answer with a valid problem body', () => json(302, { type: `${TYPE}#forbidden` }, PROBLEM)],
        ['a problem with a 1-character-too-long slug', () => json(400, { type: `#${'a'.repeat(65)}` }, PROBLEM)],
    ])('%s is UnexpectedResponse with the status', async (_n, make) => {
        const response = make();
        fetchMock.mockResolvedValue(response);
        const e = await api().getEntry(1).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(UnexpectedResponse);
        expect((e as UnexpectedResponse).status).toBe(response.status);
    });

    it('an unknown slug is still a BackendProblem (mapped to generic later)', async () => {
        fetchMock.mockResolvedValue(problem(418, 'teapot'));
        await expect(api().getEntry(1)).rejects.toMatchObject({ slug: 'teapot', status: 418 });
    });

    it('logs programming-error problems with slug and status only', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock.mockResolvedValue(problem(400, 'invalid-body', { detail: 'secret-detail-xyz' }));
        await expect(api('tok-secret').putEntry(1, { primaryPwd: 'pw-secret' })).rejects.toBeInstanceOf(BackendProblem);
        expect(spy).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(spy.mock.calls);
        expect(logged).toContain('invalid-body');
        expect(logged).toContain('400');
        for (const secret of ['secret-detail-xyz', 'tok-secret', 'pw-secret']) expect(logged).not.toContain(secret);
        spy.mockClear();
        fetchMock.mockResolvedValue(problem(403, 'forbidden'));
        await expect(api().getEntry(1)).rejects.toBeInstanceOf(BackendProblem);
        expect(spy).not.toHaveBeenCalled();
    });

    it('a 2xx with application/json and a charset is parsed', async () => {
        fetchMock.mockResolvedValue(json(200, { secondaryPwd: 'abc' }, 'application/json; charset=utf-8'));
        expect(await api().getEntry(1)).toBe('set');
    });

    it('a 200 with a non-JSON body is unexpected', async () => {
        fetchMock.mockResolvedValue(respond(200, '<html>login</html>', 'text/html'));
        await expect(api().getEntry(1)).rejects.toMatchObject({ name: 'UnexpectedResponse', status: 200 });
        fetchMock.mockResolvedValue(respond(200, 'not json', 'application/json'));
        await expect(api().getEntry(1)).rejects.toMatchObject({ name: 'UnexpectedResponse', status: 200 });
    });

    it('errors never contain the token or the passwords', async () => {
        fetchMock.mockResolvedValue(respond(500, 'tok-secret pw-secret', 'text/plain'));
        const e = (await api('tok-secret').putEntry(1, { primaryPwd: 'pw-secret', secondaryPwd: 'pw-secret' }).catch((x: unknown) => x)) as Error;
        expect(`${e.name} ${e.message} ${e.stack ?? ''}`).not.toMatch(/tok-secret|pw-secret/);
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const u = (await api('tok-secret').getEntry(1).catch((x: unknown) => x)) as Error;
        expect(`${u.name} ${u.message}`).not.toMatch(/tok-secret/);
    });
});

describe('network and timeout', () => {
    it('a TypeError from fetch is BackendUnreachable', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(api().getEntry(1)).rejects.toBeInstanceOf(BackendUnreachable);
    });

    it('an error while reading the body is BackendUnreachable', async () => {
        const broken = { status: 200, headers: new Headers({ 'Content-Type': 'application/json' }), text: () => Promise.reject(new TypeError('terminated')) };
        fetchMock.mockResolvedValue(broken);
        await expect(api().getEntry(1)).rejects.toBeInstanceOf(BackendUnreachable);
    });

    it('passes an abort signal', async () => {
        fetchMock.mockResolvedValue(json(200, { secondaryPwd: 'x' }));
        await api().getEntry(1);
        expect(lastCall().init.signal).toBeInstanceOf(AbortSignal);
    });

    const hang = () =>
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
        );

    it('the timeout is 15 s', () => {
        expect(TIMEOUT_MS).toBe(15_000);
    });

    it('aborts at exactly 15 s, not before', async () => {
        vi.useFakeTimers();
        hang();
        let result: unknown = 'pending';
        const call = api().getEntry(1).then(
            () => (result = 'resolved'),
            (e: unknown) => (result = e),
        );
        await vi.advanceTimersByTimeAsync(14_999);
        expect(result).toBe('pending');
        expect(lastCall().init.signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await call;
        expect(result).toBeInstanceOf(BackendUnreachable);
        expect(lastCall().init.signal?.aborted).toBe(true);
    });

    it('also covers a body that never arrives', async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({
            status: 200,
            headers: new Headers({ 'Content-Type': 'application/json' }),
            text: () => new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
        }));
        const call = api().getEntry(1).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(await call).toBeInstanceOf(BackendUnreachable);
    });

    it('clears the timer after success, a problem and a failure', async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValueOnce(json(200, { secondaryPwd: 'x' }));
        await api().getEntry(1);
        expect(vi.getTimerCount()).toBe(0);
        fetchMock.mockResolvedValueOnce(problem(403, 'forbidden'));
        await api().getEntry(1).catch(() => {});
        expect(vi.getTimerCount()).toBe(0);
        fetchMock.mockRejectedValueOnce(new TypeError('x'));
        await api().getEntry(1).catch(() => {});
        expect(vi.getTimerCount()).toBe(0);
    });
});
