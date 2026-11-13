import { describe, expect, it } from 'vitest';
import { createCtApi } from './api';
import { createClient } from './client';
import { CtForbiddenError, CtHttpError, CtRateLimitedError, NotAuthenticatedError } from './errors';

interface Seen {
    method: string;
    url: string;
    headers: Record<string, unknown>;
    data: unknown;
}
type Reply = { status: number; data?: unknown; headers?: Record<string, string> };

/** The real client object, with the HTTP transport replaced, so URL building, CSRF and error mapping are real. */
function setup(reply: (seen: Seen) => Reply) {
    const client = createClient('https://example.invalid/');
    const seen: Seen[] = [];
    const ax = (client as unknown as { ax: { defaults: { adapter: unknown } } }).ax;
    ax.defaults.adapter = async (config: { method: string; baseURL?: string; url: string; headers: Record<string, unknown>; data?: unknown }) => {
        const entry = { method: config.method, url: config.url, headers: { ...config.headers }, data: config.data };
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
});
