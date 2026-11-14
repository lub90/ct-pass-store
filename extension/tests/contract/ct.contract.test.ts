import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineCtContract, type CtContractSubject } from '@/ct/contract-cases';
import { CtSession, ctApiFor, dataOf, listOf } from './ct-session';
import { Cleanup, adminSession, createTempGroup, eventually, removeStaleGroups } from './instance';
import { record } from './record';
import { contractEnv } from './setup';

/**
 * The shared ChurchTools cases (`src/ct/contract-cases.ts`) against the real test instance.
 *
 * - The subject is the service user of `CT_API_TOKEN`, through the app's real `CtApi` with `Authorization: Login`
 *   and no cookies (as the real-mode dev proxy sends it). Writes go to the first category it may write
 *   (`passwordStore`) and are removed in `finally`.
 * - Two temporary groups (named `TEMP_NAME`, deleted in `afterAll`): a team with the service user, the normal test
 *   user, a `waiting` member and an archived person (the exclusion rule on real data), and a distribution list without
 *   the service user (the forbidden case).
 * - `limited`: the normal test user's session (fixture login): `view` on the extension, no category rights.
 * - `readOnly` is not offered: no test user may read the categories without also writing them, so that case is
 *   skipped here and runs against the fake only.
 */
const env = contractEnv();
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
        // The real-mode dev proxy drops the browser's cookies and adds the login token (Task 17). Measured here with a
        // session of its own that never sends a cookie back.
        const service = ctApiFor(env, { loginToken: env.apiToken });
        const moduleId = (await service.moduleId('ctpassstore')) as number;
        const categoryId = (await service.categories(moduleId))[0]!.id;
        const path = `/custommodules/${moduleId}/customdatacategories/${categoryId}/customdatavalues`;
        for (const csrf of [undefined, 'not-a-csrf-token']) {
            const session = new CtSession(env, env.apiToken);
            const send = (method: string, p: string, value?: string) =>
                fetch(`${env.apiUrl}${p}`, {
                    method,
                    headers: { Accept: 'application/json', Authorization: `Login ${env.apiToken}`, 'Content-Type': 'application/json', ...(csrf ? { 'CSRF-Token': csrf } : {}) },
                    body: value === undefined ? undefined : JSON.stringify({ value }),
                });
            const created = await send('POST', path, '{"probe":"cookieless"}');
            const id = Number(((await created.json()) as { data?: { id?: unknown } }).data?.id);
            try {
                expect(created.status, String(csrf)).toBe(201);
                expect((await send('PUT', `${path}/${id}`, '{"probe":"cookieless-2"}')).status).toBe(200);
            } finally {
                if (Number.isSafeInteger(id)) expect((await send('DELETE', `${path}/${id}`)).status).toBe(204);
            }
            expect(session.jar.header()).toBeNull();
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
        for (const m of listOf(members)) expect(typeof m.personId).toBe('number');
        record(env, 'ct-group-members', members.json);
        const anonymous = await new CtSession(env).request('GET', '/whoami');
        record(env, 'ct-whoami-anonymous', { status: anonymous.status, body: anonymous.json });
    });
});
