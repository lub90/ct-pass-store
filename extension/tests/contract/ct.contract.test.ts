import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineCtContract, type CtContractSubject } from '@/ct/contract-cases';
import { CtSession, ctApiFor, dataOf, listOf } from './ct-session';
import { Cleanup } from './cleanup';
import { adminSession, createTempGroup, eventually, removeStaleGroups } from './instance';
import { record } from './record';
import { contractEnv } from './setup';

/**
 * The shared ChurchTools cases (`src/ct/contract-cases.ts`) against the real test instance.
 *
 * - The subject is the service user of `CT_API_TOKEN`, through the app's real `CtApi` with `Authorization: Login`
 *   and no cookies (as the real-mode dev proxy sends it). Writes go to `passwordStore` (found by name, the only
 *   category it may write) and are removed in `finally`.
 * - Two temporary groups (named `TEMP_NAME`, deleted in `afterAll`): a team with the service user, the normal test
 *   user, a `waiting` member and an archived person (the exclusion rule on real data), and a distribution list without
 *   the service user (the forbidden case).
 * - `limited`: the normal test user's session (fixture login): `view` on the extension, no category rights.
 * - `readOnly` is not offered: no test user may read the categories without also writing them, so that case is
 *   skipped here and runs against the fake only.
 */
const env = contractEnv();

/** The only category the service user may write; every probe goes there, found by name. */
async function passwordStore() {
    const service = ctApiFor(env, { loginToken: env.apiToken });
    const moduleId = (await service.moduleId('ctpassstore')) as number;
    const category = (await service.categories(moduleId)).find((c) => c.name === 'passwordStore');
    if (!category) throw new Error('the service user sees no passwordStore category');
    return { moduleId, categoryId: category.id };
}
const cleanup = new Cleanup();
let subject: CtContractSubject | null = null;

beforeAll(async () => {
    const admin = await adminSession(env);
    try {
        await removeStaleGroups(admin);
        const service = ctApiFor(env, { loginToken: env.apiToken });
        const me = await service.whoami();
        const known = await createTempGroup(admin, cleanup, 2, [
            [me.id, 'active'],
            [env.normal.id, 'active'],
            [env.persons.active, 'waiting'],
            [env.persons.archived, 'active'],
        ]);
        const foreign = await createTempGroup(admin, cleanup, 4, [[env.normal.id, 'active']]);
        // Rights and memberships may take a moment to show.
        await eventually(() => service.group(known));
        const limitedSession = await new CtSession(env).login(env.normal);
        subject = {
            ...service,
            knownPersonId: env.normal.id,
            knownGroupId: known,
            foreignGroupId: foreign,
            moduleKey: 'ctpassstore',
            anonymous: async () => ctApiFor(env, null),
            limited: async () => ctApiFor(env, { jar: limitedSession.jar }),
            inactiveMemberId: env.persons.active,
            archivedMemberId: env.persons.archived,
            writeCategoryId: (await passwordStore()).categoryId,
        };
    } catch (e) {
        await cleanup.runAll().catch(() => undefined);
        throw e;
    }
});

afterAll(async () => {
    await cleanup.runAll();
});

defineCtContract('real test instance', async () => {
    if (!subject) throw new Error('the contract subject was not set up');
    return subject;
});

describe('ChurchTools, measured on the test instance', () => {
    it('REST writes with a login token need neither a session cookie nor a valid CSRF token', async () => {
        // The real-mode dev proxy drops the browser's cookies and adds the login token (Task 17).
        const { moduleId, categoryId } = await passwordStore();
        // 1. Through the app's client: it loads a CSRF token (setLoadCSRFForAPI) but never sends a cookie.
        const sent: Record<string, unknown>[] = [];
        const viaClient = ctApiFor(env, { loginToken: env.apiToken }, undefined, (headers) => void sent.push(headers));
        const created = await viaClient.createValue(moduleId, categoryId, '{"probe":"cookieless"}');
        try {
            expect((await viaClient.updateValue(moduleId, categoryId, created.id, '{"probe":"cookieless-2"}')).value).toBe('{"probe":"cookieless-2"}');
        } finally {
            await viaClient.deleteValue(moduleId, categoryId, created.id);
        }
        expect(sent.length).toBeGreaterThanOrEqual(3);
        for (const headers of sent) expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('cookie');
        // 2. By hand, without a CSRF token and with a bogus one.
        const path = `/custommodules/${moduleId}/customdatacategories/${categoryId}/customdatavalues`;
        for (const csrf of [undefined, 'not-a-csrf-token']) {
            const send = (method: string, p: string, value?: string) =>
                fetch(`${env.apiUrl}${p}`, {
                    method,
                    headers: { Accept: 'application/json', Authorization: `Login ${env.apiToken}`, 'Content-Type': 'application/json', ...(csrf ? { 'CSRF-Token': csrf } : {}) },
                    body: value === undefined ? undefined : JSON.stringify({ value }),
                });
            const answer = await send('POST', path, '{"probe":"cookieless"}');
            const id = Number(((await answer.json()) as { data?: { id?: unknown } }).data?.id);
            try {
                expect(answer.status, String(csrf)).toBe(201);
                expect((await send('PUT', `${path}/${id}`, '{"probe":"cookieless-2"}')).status).toBe(200);
            } finally {
                if (Number.isSafeInteger(id)) expect((await send('DELETE', `${path}/${id}`)).status).toBe(204);
            }
        }
    });

    it('records the raw shapes the fake is built on (only with CT_CONTRACT_RECORD=1, sanitized)', async () => {
        const session = new CtSession(env, env.apiToken);
        const whoami = await session.ok('GET', '/whoami');
        expect(typeof dataOf(whoami).id).toBe('number');
        record(env, 'ct-whoami', whoami.json);
        const permissions = await session.ok('GET', '/permissions/global');
        expect(typeof (dataOf(permissions).ctpassstore as Record<string, unknown>).view).toBe('boolean');
        record(env, 'ct-permissions-global-ctpassstore', (permissions.json as { data: Record<string, unknown> }).data.ctpassstore);
        const groupId = subject!.knownGroupId;
        const members = await session.ok('GET', `/groups/${groupId}/members?limit=100`);
        const ids = listOf(members).map((m) => m.personId);
        expect(ids).toEqual(expect.arrayContaining([env.normal.id]));
        for (const id of ids) expect(typeof id).toBe('number');
        record(env, 'ct-group-members', members.json);
        const anonymous = await new CtSession(env).request('GET', '/whoami');
        record(env, 'ct-whoami-anonymous', { status: anonymous.status, body: anonymous.json });
    });
});
