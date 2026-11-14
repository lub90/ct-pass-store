import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBackendApi, type BackendApi } from '@/backend/api';
import { defineBackendContract, type BackendContractSubject } from '@/backend/contract-cases';
import { backendBase, createHttp } from '@/backend/http';
import { BackendProblem } from '@/backend/problems';
import { tokenPerson } from '@/backend/jwt';
import { BackendSandbox, SANDBOX_BASE } from './backend-sandbox';
import { ctApiFor } from './ct-session';
import { Cleanup, adminSession, createTempOAuthClient, grantLoginRight, type TempOAuthClient } from './instance';
import { exchangeCode, fetchOAuthCode } from './oauth-code';
import { record } from './record';
import { redactBody } from './redact';
import { contractEnv } from './setup';

/**
 * The shared backend cases (`src/backend/contract-cases.ts`) against the real backend of this repository, run locally
 * as a sandbox (`backend-sandbox.ts`) against the test instance, through the app's real `BackendApi`.
 *
 * - The deployed backend of the test instance can't be used: its address answers `500` to every request (measured
 *   2026-11-14). The sandbox gets a temporary confidential OAuth client with the extension's deep redirect URI
 *   (as the backend's AdminGroupContractTest); the normal test user is granted "login to external system" for it
 *   only, and both are removed in `afterAll`.
 * - "user": the normal test user, logged in through the real OAuth flow and `POST /v1/auth/token`.
 * - "admin": nobody is an admin on the test instance (no `access` category), so this subject uses a token minted
 *   with the sandbox's per-run secret, exactly as `POST /v1/auth/token` issues it for an admin (as the backend's
 *   LiveEntriesTest does). Its login cases are skipped; the real login answer is checked by the "user" subject.
 * - Entries are only written for persons that have none before (checked first); the run refuses to start otherwise.
 *   Whatever is left after a failure is removed in `afterAll`.
 */
const env = contractEnv();
const cleanup = new Cleanup();
const realFetch = globalThis.fetch;
const service = ctApiFor(env, { loginToken: env.apiToken });

let sandbox: BackendSandbox;
let client: TempOAuthClient;
let settings: { requirePasswordForPasswordChange: boolean; allowCustomPassword: boolean; passwordLength: number };
const touched = [env.normal.id, env.persons.active, env.persons.archived, env.persons.deleted];

async function passwordStore() {
    const moduleId = (await service.moduleId('ctpassstore')) as number;
    const category = (await service.categories(moduleId)).find((c) => c.name === 'passwordStore');
    if (!category) throw new Error('the service user sees no passwordStore category');
    return { moduleId, categoryId: category.id };
}

/** Values of `passwordStore` that belong to one of the persons this file touches. */
async function touchedEntries(): Promise<number[]> {
    const { moduleId, categoryId } = await passwordStore();
    return (await service.values(moduleId, categoryId))
        .filter((v) => {
            try {
                return touched.includes((JSON.parse(v.value) as { personId?: unknown }).personId as number);
            } catch {
                return false;
            }
        })
        .map((v) => v.id);
}

async function readSettings() {
    const moduleId = (await service.moduleId('ctpassstore')) as number;
    const category = (await service.categories(moduleId)).find((c) => c.name === 'settings');
    const values = category ? await service.values(moduleId, category.id) : [];
    const newest = values.reduce<(typeof values)[number] | undefined>((a, b) => (a === undefined || b.id > a.id ? b : a), undefined);
    const s = newest ? (JSON.parse(newest.value) as Record<string, unknown>) : {};
    if (typeof s.requirePasswordForPasswordChange !== 'boolean' || typeof s.allowCustomPassword !== 'boolean' || typeof s.passwordLength !== 'number') {
        throw new Error('the settings of the test instance lack requirePasswordForPasswordChange, allowCustomPassword or passwordLength');
    }
    return { requirePasswordForPasswordChange: s.requirePasswordForPasswordChange, allowCustomPassword: s.allowCustomPassword, passwordLength: s.passwordLength };
}

const api = (token: () => string | null): BackendApi => createBackendApi(SANDBOX_BASE, token);
const freshCode = () => fetchOAuthCode(env, env.normal, client.identifier, client.redirectUri);

async function loginAsUser(): Promise<string> {
    const code = await freshCode();
    return (await api(() => null).login(code.code, code.codeVerifier, client.redirectUri)).accessToken;
}

beforeAll(async () => {
    const before = await touchedEntries();
    if (before.length > 0) throw new Error(`persons ${touched.join(', ')} must have no password entry on the test instance; the contract won't touch real entries`);
    settings = await readSettings();
    const admin = await adminSession(env);
    try {
        client = await createTempOAuthClient(env, admin, cleanup);
        await grantLoginRight(env, admin, cleanup, env.normal, client);
        sandbox = new BackendSandbox(env, { oauthClientId: client.identifier, oauthClientSecret: client.secret });
        cleanup.add('password entries of the touched persons removed', async () => {
            const { moduleId, categoryId } = await passwordStore();
            for (const id of await touchedEntries()) await service.deleteValue(moduleId, categoryId, id);
            if ((await touchedEntries()).length > 0) throw new Error('entries of the touched persons are left');
        });
        cleanup.add('backend sandbox stopped, its cache and logs deleted', () => sandbox.stop());
        await sandbox.start();
        vi.stubGlobal('fetch', sandbox.fetchFor(realFetch));
        cleanup.add('fetch restored', async () => void vi.unstubAllGlobals());
    } catch (e) {
        await cleanup.runAll().catch(() => undefined);
        throw e;
    }
});

afterAll(async () => {
    await cleanup.runAll();
});

function subject(token: () => string | null, ownPersonId: number, admin: boolean): BackendContractSubject {
    const http = createHttp(backendBase(SANDBOX_BASE), token);
    return {
        ...api(token),
        ownPersonId,
        admin,
        otherPersonId: env.persons.active,
        gonePersonId: env.persons.deleted,
        primaryPwd: settings.requirePasswordForPasswordChange ? env.normal.pwd : null,
        allowCustomPassword: settings.allowCustomPassword,
        passwordLength: settings.passwordLength,
        withoutToken: () => api(() => null),
        // Issued 16 minutes ago with the 15-minute lifetime: valid signature and claims, expired (beyond the leeway).
        expiredToken: () => api(() => sandbox.mintToken(ownPersonId, env.normal.username, admin, 16 * 60)),
        getEntryRaw: async (id) => {
            try {
                await http('GET', `/entries/${id}`);
                return 'set';
            } catch (e) {
                if (e instanceof BackendProblem && e.slug === 'entry-not-found') return 'none';
                throw e;
            }
        },
    };
}

let userToken: string | null = null;
defineBackendContract('real backend, user (OAuth login)', async () => {
    userToken ??= await loginAsUser();
    return {
        ...subject(() => userToken, env.normal.id, false),
        loginArguments: async () => {
            const code = await freshCode();
            return [code.code, code.codeVerifier, client.redirectUri];
        },
    };
});

defineBackendContract('real backend, admin (token minted as the login issues it)', async () =>
    subject(() => sandbox.mintToken(env.normal.id, env.normal.username, true), env.normal.id, true),
);

describe('ChurchTools OAuth, measured on the test instance', () => {
    it('refuses to exchange a code without the client secret (invalid_request) or with a wrong one (invalid_client)', async () => {
        const cases: [secret: string | null, error: string][] = [
            [null, 'invalid_request'],
            [`${client.secret.slice(0, -1)}${client.secret.endsWith('x') ? 'y' : 'x'}`, 'invalid_client'],
        ];
        for (const [secret, error] of cases) {
            const answer = await exchangeCode(env, client.identifier, secret, client.redirectUri, await freshCode());
            expect(answer.status, redactBody(answer.text)).toBeGreaterThanOrEqual(400);
            expect(answer.status).toBeLessThan(500);
            expect((answer.json as { error?: unknown }).error, redactBody(answer.text)).toBe(error);
            expect((answer.json as { access_token?: unknown }).access_token).toBeUndefined();
            record(env, `oauth-exchange-${secret === null ? 'without' : 'wrong'}-secret`, { status: answer.status, body: answer.json });
        }
    });
});

describe('Backend on the wire, as the browser sees it', () => {
    const origin = env.root;

    it('the token of a login works for the next call and names the person', async () => {
        const code = await freshCode();
        const raw = await realFetch(`${sandbox.httpBase}/v1/auth/token`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify({ code: code.code, codeVerifier: code.codeVerifier, redirectUri: client.redirectUri }),
        });
        const body = (await raw.json()) as Record<string, unknown>;
        expect(raw.status).toBe(200);
        expect(raw.headers.get('Content-Type')).toMatch(/^application\/json/);
        expect(raw.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(Object.keys(body).sort()).toEqual(['accessToken', 'admin', 'expiresIn', 'tokenType', 'version']);
        record(env, 'backend-login', body);
        const token = String(body.accessToken);
        expect(tokenPerson(token)).toBe(env.normal.id);
        // 'set' or 'none' (an earlier failed case may have left an entry); a token problem would throw.
        expect(['set', 'none']).toContain(await api(() => token).getEntry(env.normal.id));
    });

    it('a preflight from the ChurchTools origin allows every method and header the extension sends', async () => {
        const answer = await realFetch(`${sandbox.httpBase}/v1/entries/${env.normal.id}`, {
            method: 'OPTIONS',
            headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' },
        });
        expect(answer.status).toBe(204);
        expect(answer.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(answer.headers.get('Access-Control-Allow-Credentials')).toBeNull();
        const methods = (answer.headers.get('Access-Control-Allow-Methods') ?? '').split(',').map((m) => m.trim().toUpperCase());
        const allowed = (answer.headers.get('Access-Control-Allow-Headers') ?? '').split(',').map((h) => h.trim().toLowerCase());
        record(env, 'backend-preflight', Object.fromEntries(answer.headers));
        // Every request the contract runs above sent through the app's client: its methods and its non-safelisted
        // headers (Accept is safelisted) must pass the browser's CORS check.
        expect(sandbox.seen.length).toBeGreaterThan(10);
        for (const request of sandbox.seen) {
            expect(methods, request.method).toContain(request.method.toUpperCase());
            for (const name of request.headerNames) if (name !== 'accept') expect(allowed, name).toContain(name);
        }
    });

    it('a problem answer carries CORS headers for the ChurchTools origin, none for another origin', async () => {
        const fromCt = await realFetch(`${sandbox.httpBase}/v1/entries/${env.normal.id}`, { headers: { Accept: 'application/json', Origin: origin } });
        expect(fromCt.status).toBe(401);
        expect(fromCt.headers.get('Content-Type')).toMatch(/^application\/problem\+json/);
        expect(fromCt.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(fromCt.headers.get('Vary') ?? '').toMatch(/Origin/);
        expect(fromCt.headers.get('Cache-Control')).toBe('no-store');
        const problem = (await fromCt.json()) as Record<string, unknown>;
        expect(problem).toMatchObject({ status: 401, type: expect.stringMatching(/\/backend\/docs\/problems\.md#missing-token$/), title: expect.any(String) });
        record(env, 'backend-problem-missing-token', problem);

        const fromElsewhere = await realFetch(`${sandbox.httpBase}/v1/entries/${env.normal.id}`, { headers: { Accept: 'application/json', Origin: 'https://evil.example' } });
        expect(fromElsewhere.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('an admin gets person-not-found for an archived person too', async () => {
        const admin = api(() => sandbox.mintToken(env.normal.id, env.normal.username, true));
        const problem = await admin.getEntry(env.persons.archived).catch((e: unknown) => e);
        expect(problem).toBeInstanceOf(BackendProblem);
        expect(problem).toMatchObject({ slug: 'person-not-found', status: 404 });
    });
});
