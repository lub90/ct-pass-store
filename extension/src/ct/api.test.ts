import { describe, expect, it } from 'vitest';
import { createCtApi, mapCtError } from './api';
import { createClient } from './client';
import { CtForbiddenError, CtHttpError, CtInvalidIdError, CtRateLimitedError, NotAuthenticatedError } from './errors';

interface Seen {
    method: string;
    url: string;
    headers: Record<string, unknown>;
    data: unknown;
    params?: Record<string, unknown>;
}
type Reply = { status: number; data?: unknown; headers?: Record<string, string> };

/** The real client object, with the HTTP transport replaced, so URL building, CSRF and error mapping are real. */
function setup(reply: (seen: Seen) => Reply) {
    const client = createClient('https://example.invalid/');
    const seen: Seen[] = [];
    const ax = (client as unknown as { ax: { defaults: { adapter: unknown } } }).ax;
    ax.defaults.adapter = async (config: { method: string; baseURL?: string; url: string; headers: Record<string, unknown>; data?: unknown; params?: Record<string, unknown> }) => {
        const entry = { method: config.method, url: config.url, headers: { ...config.headers }, data: config.data, params: config.params };
        seen.push(entry);
        const r = reply(entry);
        const response = { status: r.status, statusText: '', data: r.data ?? {}, headers: r.headers ?? {}, config, request: {} };
        if (r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status}`), { isAxiosError: true, response });
        return response;
    };
    return { api: createCtApi(client, 'ctpassstore'), seen };
}

describe('createCtApi with the real client', () => {
    it('builds /api urls and maps whoami', async () => {
        const { api, seen } = setup(() => ({ status: 200, data: { data: { id: 4, firstName: 'A', lastName: 'B' } } }));
        expect(await api.whoami()).toEqual({ id: 4, firstName: 'A', lastName: 'B' });
        expect(seen[0]?.url).toBe('https://example.invalid/api/whoami');
    });

    it('treats id -1 as not logged in', async () => {
        const { api } = setup(() => ({ status: 200, data: { data: { id: -1 } } }));
        await expect(api.whoami()).rejects.toBeInstanceOf(NotAuthenticatedError);
    });

    it('maps 400 of the module lookup to null', async () => {
        const { api } = setup(() => ({ status: 400, data: { messageKey: 'validation.integer' } }));
        expect(await api.moduleId('nope')).toBeNull();
    });

    it('sends the CSRF token with a write', async () => {
        const { api, seen } = setup((s) =>
            s.url.endsWith('/csrftoken')
                ? { status: 200, data: { data: 'tok123' } }
                : { status: 200, data: { data: { id: 9, dataCategoryId: 5, value: '{}' } } },
        );
        await api.createValue(7, 5, '{}');
        const post = seen.find((s) => s.method === 'post');
        expect(post?.url).toBe('https://example.invalid/api/custommodules/7/customdatacategories/5/customdatavalues');
        expect(JSON.stringify(post?.headers)).toContain('tok123');
    });

    it('maps 403 with the missing right, 401, 429 with Retry-After, and other statuses', async () => {
        let status = 403;
        const { api } = setup(() => ({ status, data: { message: 'Forbidden to see group' }, headers: { 'retry-after': '120' } }));
        const forbidden = await api.group(3).catch((e: unknown) => e);
        expect(forbidden).toBeInstanceOf(CtForbiddenError);
        expect((forbidden as CtForbiddenError).missing).toBe('view group');
        status = 401;
        await expect(api.group(3)).rejects.toBeInstanceOf(NotAuthenticatedError);
        status = 429;
        const limited = await api.group(3).catch((e: unknown) => e);
        expect((limited as CtRateLimitedError).retryAfterMs).toBe(120_000);
        status = 500;
        await expect(api.group(3)).rejects.toBeInstanceOf(CtHttpError);
    });

    it('normalises permissions of the extension module', async () => {
        const { api } = setup(() => ({ status: 200, data: { data: { ctpassstore: { view: true, 'view custom category': [4, 10] } } } }));
        const p = await api.globalPermissions();
        expect(p.view).toBe(true);
        expect(p['view custom category']).toEqual([4, 10]);
        expect(p['edit custom data']).toEqual([]);
        expect(p['create custom category']).toBe(false);
    });

    const member = (personId: number, status: string, over: Record<string, unknown> = {}) => ({
        personId,
        groupMemberStatus: status,
        person: {
            title: `P${personId} Name`,
            domainType: 'person',
            domainIdentifier: String(personId),
            domainAttributes: { firstName: `P${personId}`, lastName: 'Name', isArchived: false, ...over },
        },
    });

    it('reads all pages of members and keeps only active, non-archived ones', async () => {
        const { api, seen } = setup((s) => {
            if (s.url.endsWith('/members')) {
                const page = Number(s.params?.page);
                return {
                    status: 200,
                    data:
                        page === 1
                            ? { data: [member(1, 'active'), member(2, 'waiting')], meta: { pagination: { lastPage: 2, total: 4 } } }
                            : { data: [member(3, 'active', { isArchived: true }), member(4, 'active')], meta: { pagination: { lastPage: 2, total: 4 } } },
                };
            }
            return { status: 200, data: { data: { id: 9, name: 'Team', information: { memberCount: 99 } } } };
        });
        expect((await api.groupMembers(9)).map((m) => m.id)).toEqual([1, 4]);
        expect(seen.filter((s) => s.url.endsWith('/members')).map((s) => s.params?.page)).toEqual([1, 2]);
        // The count comes from the filtered list, not from `information`.
        expect(await api.group(9)).toEqual({ id: 9, name: 'Team', memberCount: 2 });
    });

    it('maps the measured member payload to picker options', async () => {
        const { api } = setup(() => ({
            status: 200,
            data: {
                data: [
                    member(7, 'active'),
                    { personId: 8, groupMemberStatus: 'active', person: { domainAttributes: { firstName: 'Zoe', lastName: 'Zed' } } },
                    { personId: 0, groupMemberStatus: 'active', person: { title: 'Bad' } },
                ],
                meta: { pagination: { lastPage: 1, total: 3 } },
            },
        }));
        expect(await api.groupMembers(1)).toEqual([
            { id: 7, name: 'P7 Name' },
            { id: 8, name: 'Zoe Zed' },
        ]);
    });
});

const headerOf = (headers: Record<string, unknown>, name: string) =>
    Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
const body = (s: Seen | undefined) => JSON.parse(typeof s?.data === 'string' ? s.data : '{}') as Record<string, unknown>;
const ok = (data: unknown): Reply => ({ status: 200, data: { data } });
/** Answers `/csrftoken` and delegates the rest. */
const withCsrf = (inner: (s: Seen) => Reply) => (s: Seen): Reply => (s.url.endsWith('/csrftoken') ? ok('tok') : inner(s));
const lastCall = (seen: Seen[]) => seen.filter((s) => !s.url.endsWith('/csrftoken')).at(-1);

describe('whoami with unusable ids', () => {
    it.each([[-1], [0], [undefined], ['x'], ['4'], [null], [1.5]])('id %j is not logged in', async (id) => {
        const { api } = setup(() => ok({ id, firstName: 'A', lastName: 'B' }));
        await expect(api.whoami()).rejects.toBeInstanceOf(NotAuthenticatedError);
    });
});

describe('moduleId errors', () => {
    it.each([
        [403, CtForbiddenError],
        [429, CtRateLimitedError],
        [500, CtHttpError],
        [401, NotAuthenticatedError],
    ])('%i rejects with the mapped error, never null', async (status, error) => {
        const { api } = setup(() => ({ status }));
        await expect(api.moduleId('k')).rejects.toBeInstanceOf(error);
    });

    it('a network error passes through unchanged', async () => {
        const failure = new Error('network down');
        const { api } = setup(() => {
            throw failure;
        });
        await expect(api.moduleId('k')).rejects.toBe(failure);
    });

    it('a 200 whose id is not a number is null; a number is returned; the key is encoded', async () => {
        const bad = setup(() => ok({ id: '7' }));
        expect(await bad.api.moduleId('k')).toBeNull();
        const good = setup(() => ok({ id: 7 }));
        expect(await good.api.moduleId('a/b')).toBe(7);
        expect(good.seen[0]?.url).toBe('https://example.invalid/api/custommodules/a%2Fb');
    });
});

describe('mapCtError', () => {
    it('passes errors without an HTTP response unchanged', () => {
        const e = new Error('x');
        expect(mapCtError(e)).toBe(e);
        expect(mapCtError(null)).toBeNull();
        expect(mapCtError({ response: {} })).toEqual({ response: {} });
    });
});

describe('requests and mapping', () => {
    it('categories: GET url and mapped fields', async () => {
        const { api, seen } = setup(() => ok([{ id: 5, name: 'N', shorty: 's', description: 'd', customModuleId: 7 }]));
        expect(await api.categories(7)).toEqual([{ id: 5, name: 'N', shorty: 's' }]);
        expect(seen[0]).toMatchObject({ method: 'get', url: 'https://example.invalid/api/custommodules/7/customdatacategories' });
    });

    it('values: GET url and mapped fields, 403 names "view custom data"', async () => {
        const { api, seen } = setup(() => ok([{ id: 1, dataCategoryId: 5, value: '{"a":1}' }, { id: 2, value: '{}' }]));
        expect(await api.values(7, 5)).toEqual([
            { id: 1, dataCategoryId: 5, value: '{"a":1}' },
            { id: 2, dataCategoryId: 5, value: '{}' },
        ]);
        expect(seen[0]?.url).toBe('https://example.invalid/api/custommodules/7/customdatacategories/5/customdatavalues');
        const denied = setup(() => ({ status: 403 }));
        expect(await denied.api.values(7, 5).catch((e: unknown) => e)).toMatchObject({ name: 'CtForbiddenError', missing: 'view custom data' });
    });

    it('createValue: POST body and result, 403 names "create custom data"', async () => {
        const { api, seen } = setup(withCsrf(() => ok({ id: 9, dataCategoryId: 5, value: '{"a":1}' })));
        expect(await api.createValue(7, 5, '{"a":1}')).toEqual({ id: 9, dataCategoryId: 5, value: '{"a":1}' });
        const call = lastCall(seen);
        expect(call?.method).toBe('post');
        expect(call?.url).toBe('https://example.invalid/api/custommodules/7/customdatacategories/5/customdatavalues');
        expect(body(call)).toMatchObject({ dataCategoryId: 5, value: '{"a":1}' });
        const denied = setup(withCsrf(() => ({ status: 403 })));
        expect(await denied.api.createValue(7, 5, '{}').catch((e: unknown) => e)).toMatchObject({ missing: 'create custom data' });
    });

    it('updateValue: PUT body and result, 403 names "edit custom data"', async () => {
        const { api, seen } = setup(withCsrf(() => ok({ id: 9, dataCategoryId: 5, value: '{"b":2}' })));
        expect(await api.updateValue(7, 5, 9, '{"b":2}')).toEqual({ id: 9, dataCategoryId: 5, value: '{"b":2}' });
        const call = lastCall(seen);
        expect(call?.method).toBe('put');
        expect(call?.url).toBe('https://example.invalid/api/custommodules/7/customdatacategories/5/customdatavalues/9');
        expect(body(call)).toMatchObject({ dataCategoryId: 5, value: '{"b":2}' });
        const denied = setup(withCsrf(() => ({ status: 403 })));
        expect(await denied.api.updateValue(7, 5, 9, '{}').catch((e: unknown) => e)).toMatchObject({ missing: 'edit custom data' });
    });

    it('deleteValue: DELETE url, 403 names "delete custom data"', async () => {
        const { api, seen } = setup(withCsrf(() => ({ status: 204 })));
        await api.deleteValue(7, 5, 9);
        const call = lastCall(seen);
        expect(call?.method).toBe('delete');
        expect(call?.url).toBe('https://example.invalid/api/custommodules/7/customdatacategories/5/customdatavalues/9');
        const denied = setup(withCsrf(() => ({ status: 403 })));
        expect(await denied.api.deleteValue(7, 5, 9).catch((e: unknown) => e)).toMatchObject({ missing: 'delete custom data' });
    });

    it('person: GET url and name from first and last name; 403 and 404 are mapped', async () => {
        const { api, seen } = setup(() => ok({ id: 3, firstName: 'Ann', lastName: 'Lee', email: 'x' }));
        expect(await api.person(3)).toEqual({ id: 3, name: 'Ann Lee' });
        expect(seen[0]?.url).toBe('https://example.invalid/api/persons/3');
        const missing = setup(() => ({ status: 404 }));
        expect(await missing.api.person(3).catch((e: unknown) => e)).toMatchObject({ name: 'CtHttpError', status: 404 });
    });
});

describe('group members filter', () => {
    const entry = (over: Record<string, unknown>) => ({
        personId: 1,
        groupMemberStatus: 'active',
        person: { title: 'T', domainIdentifier: '1', domainAttributes: { firstName: 'F', lastName: 'L', isArchived: false } },
        ...over,
    });
    const members = async (list: unknown[]) => {
        const { api } = setup(() => ({ status: 200, data: { data: list, meta: { pagination: { lastPage: 1 } } } }));
        return api.groupMembers(1);
    };

    it.each(['waiting', 'requested', 'to_delete', 'bogus', undefined])('status %j is excluded', async (status) => {
        expect(await members([entry({ groupMemberStatus: status })])).toEqual([]);
    });

    it('takes the id from domainIdentifier when personId is missing', async () => {
        expect(await members([entry({ personId: undefined, person: { title: 'T', domainIdentifier: '12' } })])).toEqual([{ id: 12, name: 'T' }]);
    });

    it('skips an unusable personId', async () => {
        expect(await members([entry({ personId: 'abc' }), entry({ personId: -3 })])).toEqual([]);
    });

    it('lists the same person from two pages once', async () => {
        const { api } = setup((s) => ({
            status: 200,
            data: { data: [entry({ personId: 5 }), entry({ personId: Number(s.params?.page) + 5 })], meta: { pagination: { lastPage: 2 } } },
        }));
        expect((await api.groupMembers(1)).map((m) => m.id)).toEqual([5, 6, 7]);
    });

    it('skips a member without title or names', async () => {
        expect(await members([entry({ person: { domainAttributes: {} } }), entry({ person: undefined })])).toEqual([]);
    });
});

describe('globalPermissions safety', () => {
    const perms = async (own: unknown, all: Record<string, unknown> = { ctpassstore: own }) => {
        const { api } = setup(() => ok(all));
        return api.globalPermissions();
    };

    it.each([['true'], [1], ['yes'], [null], [{}]])('view %j does not grant view', async (view) => {
        expect((await perms({ view })).view).toBe(false);
        expect((await perms({ 'create custom category': view }))['create custom category']).toBe(false);
    });

    it('a missing module key grants nothing', async () => {
        const p = await perms(undefined, { other: { view: true } });
        expect(p.view).toBe(false);
        expect(p['view custom data']).toEqual([]);
    });

    it('a null response grants nothing', async () => {
        expect((await perms(undefined, null as never)).view).toBe(false);
    });

    it('a right that is null, true or an object is []', async () => {
        const p = await perms({ 'view custom data': null, 'edit custom data': true, 'create custom data': { 0: 4 } });
        expect(p['view custom data']).toEqual([]);
        expect(p['edit custom data']).toEqual([]);
        expect(p['create custom data']).toEqual([]);
    });

    it('list entries that are not positive integers are dropped', async () => {
        const p = await perms({ 'view custom data': [4, '5', null, 'x', -1, 0, 1.5, true, 10] });
        expect(p['view custom data']).toEqual([4, 10]);
    });
});

describe('authenticated-only requests (F2)', () => {
    it('sends X-OnlyAuthenticated: 1 on reads and writes', async () => {
        const { api, seen } = setup(withCsrf(() => ok({ id: 9, dataCategoryId: 5, value: '{}' })));
        await api.categories(7).catch(() => undefined);
        await api.createValue(7, 5, '{}');
        const calls = seen.filter((s) => !s.url.endsWith('/csrftoken'));
        expect(calls.length).toBe(2);
        for (const c of calls) expect(headerOf(c.headers, 'X-OnlyAuthenticated')).toBe('1');
    });

    it('an expired session (401) becomes NotAuthenticatedError', async () => {
        const { api } = setup(() => ({ status: 401 }));
        await expect(api.categories(7)).rejects.toBeInstanceOf(NotAuthenticatedError);
    });
});

describe('path ids are checked before any request (F3)', () => {
    const bad = [0, -1, 1.5, NaN, Infinity, 2 ** 53, '3', null, undefined] as unknown as number[];
    it.each(bad.map((b) => [b]))('id %j is rejected', async (id) => {
        const { api, seen } = setup(() => ok({}));
        const calls = [
            () => api.person(id),
            () => api.group(id),
            () => api.groupMembers(id),
            () => api.categories(id),
            () => api.values(id, 5),
            () => api.values(7, id),
            () => api.createValue(id, 5, '{}'),
            () => api.createValue(7, id, '{}'),
            () => api.updateValue(7, 5, id, '{}'),
            () => api.updateValue(id, 5, 1, '{}'),
            () => api.deleteValue(7, id, 1),
            () => api.deleteValue(7, 5, id),
        ];
        for (const call of calls) await expect(call()).rejects.toBeInstanceOf(CtInvalidIdError);
        expect(seen).toEqual([]);
    });
});
