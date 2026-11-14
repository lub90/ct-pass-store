import { CtSession, dataOf, listOf } from './ct-session';
import type { ContractEnv, FixtureUser } from './setup';

/** Every temporary object of the contract layer carries this name, so a crashed run's leftovers can be found. */
export const TEMP_NAME = 'ctpassstore extension contract test';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Undo steps, run last-in first-out. Every step runs even when an earlier one fails; the failures are thrown together
 * at the end, so a cleanup problem is never hidden. `done` lists what was removed or restored (for the report).
 */
export class Cleanup {
    private steps: { label: string; run: () => Promise<void> }[] = [];
    readonly done: string[] = [];

    add(label: string, run: () => Promise<void>): void {
        this.steps.push({ label, run });
    }

    async runAll(): Promise<void> {
        const failures: string[] = [];
        while (this.steps.length > 0) {
            const step = this.steps.pop()!;
            try {
                await step.run();
                this.done.push(step.label);
            } catch (e) {
                failures.push(`${step.label}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (this.done.length > 0) console.info(`[contract cleanup] ${this.done.join('; ')}`);
        if (failures.length > 0) {
            console.error(`[contract cleanup] WARNING, check by hand: ${failures.join('; ')}`);
            throw new Error(`Cleanup failed, check the test instance by hand: ${failures.join('; ')}`);
        }
    }
}

export async function adminSession(env: ContractEnv): Promise<CtSession> {
    return new CtSession(env).login(env.admin);
}

/** Groups named `TEMP_NAME` (left by crashed runs). */
async function staleGroups(admin: CtSession): Promise<number[]> {
    const a = await admin.ok('GET', `/groups?query=${encodeURIComponent(TEMP_NAME)}&limit=100`);
    return listOf(a)
        .filter((g) => g.name === TEMP_NAME)
        .map((g) => Number(g.id));
}

async function deleteGroup(admin: CtSession, id: number): Promise<void> {
    await admin.ok('DELETE', `/groups/${id}`, { csrf: true });
    const after = await admin.request('GET', `/groups/${id}`);
    if (after.status !== 404) throw new Error(`group ${id} still answers ${after.status} after DELETE`);
}

export async function removeStaleGroups(admin: CtSession): Promise<void> {
    for (const id of await staleGroups(admin)) await deleteGroup(admin, id);
}

/**
 * A temporary group of `groupTypeId` with the given members (status per person, the type's default role), removed by
 * `cleanup`. Measured: a membership needs a role, or not even the members can read the group.
 */
export async function createTempGroup(admin: CtSession, cleanup: Cleanup, groupTypeId: number, members: [personId: number, status: string][]): Promise<number> {
    const roles = listOf(await admin.ok('GET', '/group/roles'));
    const role = roles.find((r) => r.groupTypeId === groupTypeId && r.isDefault === true)?.id;
    if (typeof role !== 'number') throw new Error(`group type ${groupTypeId} has no default role`);
    const created = await admin.ok('POST', '/groups', { json: { name: TEMP_NAME, groupTypeId, groupStatusId: 1, force: true }, csrf: true });
    const id = Number(dataOf(created).id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('creating the temporary group gave no id');
    cleanup.add(`temporary group ${id} deleted`, () => deleteGroup(admin, id));
    for (const [personId, groupMemberStatus] of members) {
        await admin.ok('PUT', `/groups/${id}/members/${personId}`, { json: { groupMemberStatus, groupTypeRoleId: role }, csrf: true });
    }
    return id;
}

/** Waits until `read` resolves without throwing (ChurchTools caches rights briefly), at most `seconds`. */
export async function eventually<T>(read: () => Promise<T>, seconds = 30): Promise<T> {
    let last: unknown;
    for (let i = 0; i < seconds; i++) {
        try {
            return await read();
        } catch (e) {
            last = e;
            await sleep(1000);
        }
    }
    throw last;
}

export interface TempOAuthClient {
    identifier: string;
    secret: string;
    numericId: number;
    redirectUri: string;
}

async function oauthClients(admin: CtSession): Promise<Record<string, unknown>[]> {
    return listOf(await admin.ok('GET', '/oauthclients'));
}

async function deleteOAuthClient(admin: CtSession, identifier: string): Promise<void> {
    await admin.ok('DELETE', `/oauthclients/${encodeURIComponent(identifier)}`, { csrf: true });
    if ((await oauthClients(admin)).some((c) => c.identifier === identifier)) throw new Error('the temporary OAuth client is still listed after DELETE');
}

/** A confidential OAuth client with the extension's deep redirect URI, removed by `cleanup`. The secret stays in memory. */
export async function createTempOAuthClient(env: ContractEnv, admin: CtSession, cleanup: Cleanup): Promise<TempOAuthClient> {
    for (const c of await oauthClients(admin)) {
        if (c.name === TEMP_NAME && typeof c.identifier === 'string') await deleteOAuthClient(admin, c.identifier);
    }
    const redirectUri = `${env.root}/ccm/ctpassstore/auth/callback`;
    const created = await admin.ok('POST', '/oauthclients', { json: { name: TEMP_NAME, redirectUri, confidential: true }, csrf: true });
    const raw = (created.json as { data?: unknown }).data;
    const data = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
    const client = { identifier: String(data?.identifier ?? ''), secret: String(data?.clientSecret ?? ''), numericId: Number(data?.id), redirectUri };
    if (client.identifier !== '') cleanup.add('temporary OAuth client deleted', () => deleteOAuthClient(admin, client.identifier));
    if (client.identifier === '' || client.secret === '' || !Number.isSafeInteger(client.numericId)) throw new Error('creating the OAuth client gave no identifier, secret or id');
    return client;
}

/** The person's own (not inherited) grants as sorted "authId:dataId" strings. */
async function grants(admin: CtSession, personId: number): Promise<string[]> {
    const list = listOf(await admin.ok('GET', `/permissions/person/${personId}`));
    return list
        .filter((e) => e.isInherited === false)
        .map((e) => `${String(e.authId)}:${String(e.dataId)}`)
        .sort();
}

/**
 * Grants `user` "login to external system" for the temporary client only (maintainer-approved). `PUT` adds to the
 * person's list for that right; `cleanup` removes exactly this entry with `DELETE` and the same body and then checks
 * that all of the person's own grants are as before.
 */
export async function grantLoginRight(env: ContractEnv, admin: CtSession, cleanup: Cleanup, user: FixtureUser, client: TempOAuthClient): Promise<void> {
    const master = await admin.ok('POST', `${env.root}/index.php?q=churchauth/ajax`, { form: { func: 'getMasterData' }, csrf: true });
    const table = (master.json as { data?: { auth_table?: Record<string, Record<string, { id?: unknown }>> } }).data?.auth_table;
    const authId = table?.churchcore?.['login to external system']?.id;
    if (typeof authId !== 'number') throw new Error('no auth id for "login to external system" in the rights master data');
    const before = await grants(admin, user.id);
    const body = { authId, dataId: [client.numericId] };
    cleanup.add(`login right of person ${user.id} for the temporary client removed, own grants as before`, async () => {
        await admin.ok('DELETE', `/permissions/person/${user.id}`, { json: body, csrf: true });
        const now = await grants(admin, user.id);
        if (JSON.stringify(now) !== JSON.stringify(before)) throw new Error(`the permissions of person ${user.id} differ from the start`);
    });
    await admin.ok('PUT', `/permissions/person/${user.id}`, { json: body, csrf: true });

    const session = await new CtSession(env).login(user);
    await eventually(async () => {
        const ids = (dataOf(await session.ok('GET', '/permissions/global')).churchcore as Record<string, unknown> | undefined)?.['login to external system'];
        if (!Array.isArray(ids) || !ids.includes(client.numericId)) throw new Error('The login right for the temporary client did not show up in /permissions/global after 30 s.');
    });
}
