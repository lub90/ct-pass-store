import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBackendApi, type BackendApi } from '@/backend/api';
import { defineBackendContract, type BackendContractSubject } from '@/backend/contract-cases';
import { backendBase, createHttp } from '@/backend/http';
import { BackendProblem } from '@/backend/problems';
import { tokenPerson } from '@/backend/jwt';
import { BackendSandbox, type SettingsVariant } from './backend-sandbox';
import { CtSession, ctApiFor, listOf } from './ct-session';
import { Cleanup } from './cleanup';
import { adminSession, createTempOAuthClient, grantLoginRight, type TempOAuthClient } from './instance';
import { exchangeCode, fetchOAuthCode } from './oauth-code';
import { record } from './record';
import { redactBody } from './redact';
import { contractEnv } from './setup';

/**
 * The shared backend cases (`src/backend/contract-cases.ts`) against the real backend of this repository, run locally
 * as sandboxes (`backend-sandbox.ts`) against the test instance, through the app's real `BackendApi`.
 *
 * - The deployed backend of the test instance can't be used: its address answers `500` to every request (measured
 *   2026-11-14). The sandbox gets a temporary confidential OAuth client with the extension's deep redirect URI
 *   (as the backend's AdminGroupContractTest); the normal test user is granted "login to external system" for it
 *   only, and both are removed in `afterAll`.
 * - Settings variants: every case runs once per entry of `VARIANTS`, each with its own sandboxes. The sandbox's
 *   backend reads `requirePasswordForPasswordChange` and `allowCustomPassword` from the variant instead of the
 *   instance's settings value (`sandbox/SandboxChurchTools.php`); the instance's settings are never written. Every
 *   other setting (`passwordLength`, …), the persons, groups, rights and entries are the instance's.
 * - "user": the normal test user, logged in through the real OAuth flow and `POST /v1/auth/token`, on a sandbox that
 *   reads `access` from the instance (it has none, so nobody is an admin).
 * - "admin": the same user and the same real login, on a sandbox whose backend sees an `access` value naming a group
 *   the user is already an active member of as the admin group (the instance has no `access` category, and its groups
 *   stay as they are). Membership is read from ChurchTools with the user's own token, as in production.
 * - Entries are only written for persons that have none before (checked first); the run refuses to start otherwise.
 *   Whatever is left after a failure is removed in `afterAll`.
 */
// Rate-limited calls are waited out (`patiently`, `CtSession.login`), so a case may take a few minutes.
vi.setConfig({ testTimeout: 600_000 });

const env = contractEnv();
const cleanup = new Cleanup();
const realFetch = globalThis.fetch;
const service = ctApiFor(env, { loginToken: env.apiToken });

/** Each variant un-skips the cases the other one skips: custom passwords on/off, primary password required or not. */
const VARIANTS: { key: string; name: string; settings: SettingsVariant }[] = [
    { key: 'open', name: 'primary password not required, custom passwords allowed', settings: { requirePasswordForPasswordChange: false, allowCustomPassword: true } },
    { key: 'strict', name: 'primary password required, custom passwords off', settings: { requirePasswordForPasswordChange: true, allowCustomPassword: false } },
];
/** The variant of the wire checks below. */
const WIRE_VARIANT = VARIANTS[0]!;
const sandboxes = new Map<string, { user: BackendSandbox; admin: BackendSandbox }>();
/** The sandbox of the wire checks below: the user sandbox of `WIRE_VARIANT`. */
let sandbox: BackendSandbox;
let client: TempOAuthClient;
let instance: { passwordLength: number; settingsCategoryId: number };
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

/** The instance's settings value (read only) and its category, which the sandboxes override. */
async function readSettings() {
    const moduleId = (await service.moduleId('ctpassstore')) as number;
    const category = (await service.categories(moduleId)).find((c) => c.name === 'settings');
    if (!category) throw new Error('the service user sees no settings category');
    const values = await service.values(moduleId, category.id);
    const newest = values.reduce<(typeof values)[number] | undefined>((a, b) => (a === undefined || b.id > a.id ? b : a), undefined);
    const s = newest ? (JSON.parse(newest.value) as Record<string, unknown>) : {};
    if (typeof s.requirePasswordForPasswordChange !== 'boolean' || typeof s.allowCustomPassword !== 'boolean' || typeof s.passwordLength !== 'number') {
        throw new Error('the settings of the test instance lack requirePasswordForPasswordChange, allowCustomPassword or passwordLength');
    }
    return { passwordLength: s.passwordLength, settingsCategoryId: category.id };
}

/** A group the normal user is an active member of (the backend's admin check reads exactly that), or an error. */
async function activeGroupOfNormalUser(): Promise<number> {
    const session = await new CtSession(env).login(env.normal);
    const memberships = listOf(await session.ok('GET', `/persons/${env.normal.id}/groups?limit=100`));
    const id = memberships
        .filter((m) => m.groupMemberStatus === 'active')
        .map((m) => Number((m.group as { domainIdentifier?: unknown } | undefined)?.domainIdentifier))
        .find((n) => Number.isSafeInteger(n) && n > 0);
    if (id === undefined) throw new Error(`person ${env.normal.id} is an active member of no group; the admin subject needs one`);
    return id;
}

const apiOn = (box: BackendSandbox, token: () => string | null): BackendApi => createBackendApi(box.base, token);
const api = (token: () => string | null): BackendApi => apiOn(sandbox, token);
/** The normal user's ChurchTools session for the authorization step, so a code doesn't cost a login of its own. */
let normalSession: Promise<CtSession> | null = null;
const freshCode = async () => {
    normalSession ??= new CtSession(env).login(env.normal);
    return fetchOAuthCode(env, env.normal, client.identifier, client.redirectUri, await normalSession);
};

/**
 * ChurchTools limits logins, and with a required primary password every write is one (the backend checks the password
 * with `POST /login`). An `upstream-rate-limited` answer is therefore waited out (its `retryAfter`, at most 90 s) and
 * the same call sent again, twice at most; any other answer, the last one included, goes to the case unchanged.
 */
let rateLimitWaits = 0;
async function patiently<T>(call: () => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry++) {
        try {
            return await call();
        } catch (e) {
            if (retry >= 2 || !(e instanceof BackendProblem) || e.slug !== 'upstream-rate-limited') throw e;
            rateLimitWaits++;
            await new Promise((r) => setTimeout(r, Math.min(e.retryAfter ?? 60, 90) * 1000));
        }
    }
}

/** `api` with the entry and self-test calls sent `patiently` (login isn't: a code is used up by the first try). */
function patientApi(api: BackendApi): BackendApi {
    return {
        ...api,
        getEntry: (id) => patiently(() => api.getEntry(id)),
        putEntry: (id, body) => patiently(() => api.putEntry(id, body)),
        deleteEntry: (id, pwd) => patiently(() => api.deleteEntry(id, pwd)),
        selfTest: (write) => patiently(() => api.selfTest(write)),
    };
}

async function loginOn(box: BackendSandbox): Promise<string> {
    const code = await freshCode();
    return (await apiOn(box, () => null).login(code.code, code.codeVerifier, client.redirectUri)).accessToken;
}

beforeAll(async () => {
    const before = await touchedEntries();
    if (before.length > 0) throw new Error(`persons ${touched.join(', ')} must have no password entry on the test instance; the contract won't touch real entries`);
    instance = await readSettings();
    const adminGroupId = await activeGroupOfNormalUser();
    const admin = await adminSession(env);
    try {
        client = await createTempOAuthClient(env, admin, cleanup, env.normal);
        await grantLoginRight(env, admin, cleanup, env.normal, client);
        cleanup.add('password entries of the touched persons removed', async () => {
            const { moduleId, categoryId } = await passwordStore();
            for (const id of await touchedEntries()) await service.deleteValue(moduleId, categoryId, id);
            if ((await touchedEntries()).length > 0) throw new Error('entries of the touched persons are left');
        });
        let fetchChain = realFetch;
        for (const variant of VARIANTS) {
            const make = (role: 'user' | 'admin') => {
                const box = new BackendSandbox(env, {
                    oauthClientId: client.identifier,
                    oauthClientSecret: client.secret,
                    base: `https://${variant.key}-${role}.backend.contract.invalid`,
                    settings: { variant: variant.settings, categoryId: instance.settingsCategoryId },
                    ...(role === 'admin' ? { adminGroupId } : {}),
                });
                cleanup.add(`backend sandbox ${variant.key}-${role} stopped, its cache and logs deleted`, () => box.stop());
                return box;
            };
            const pair = { user: make('user'), admin: make('admin') };
            await pair.user.start();
            await pair.admin.start();
            fetchChain = pair.admin.fetchFor(pair.user.fetchFor(fetchChain));
            sandboxes.set(variant.key, pair);
        }
        sandbox = sandboxes.get(WIRE_VARIANT.key)!.user;
        vi.stubGlobal('fetch', fetchChain);
        cleanup.add('fetch restored', async () => void vi.unstubAllGlobals());
    } catch (e) {
        await cleanup.runAll().catch(() => undefined);
        throw e;
    }
});

afterAll(async () => {
    if (rateLimitWaits > 0) console.info(`[contract] waited out ${rateLimitWaits} upstream-rate-limited answer(s) of the backend`);
    await cleanup.runAll();
});

/** The normal user on `box` with the token of a real login there, as a user or (admin sandbox) as an admin. */
function subject(variant: (typeof VARIANTS)[number], box: BackendSandbox, admin: boolean, token: string): BackendContractSubject {
    const current = () => token;
    const http = createHttp(backendBase(box.base), current);
    return {
        ...patientApi(apiOn(box, current)),
        ownPersonId: env.normal.id,
        admin,
        otherPersonId: env.persons.active,
        gonePersonId: env.persons.deleted,
        primaryPwd: variant.settings.requirePasswordForPasswordChange ? env.normal.pwd : null,
        allowCustomPassword: variant.settings.allowCustomPassword,
        passwordLength: instance.passwordLength,
        withoutToken: () => apiOn(box, () => null),
        // Issued 16 minutes ago with the 15-minute lifetime: valid signature and claims, expired (beyond the leeway).
        expiredToken: () => apiOn(box, () => box.mintToken(env.normal.id, env.normal.username, admin, 16 * 60)),
        getEntryRaw: async (id) => {
            try {
                await http('GET', `/entries/${id}`);
                return 'set';
            } catch (e) {
                if (e instanceof BackendProblem && e.slug === 'entry-not-found') return 'none';
                throw e;
            }
        },
        loginArguments: async () => {
            const code = await freshCode();
            return [code.code, code.codeVerifier, client.redirectUri];
        },
    };
}

for (const variant of VARIANTS) {
    for (const role of ['user', 'admin'] as const) {
        // One real login per subject, on first use (the token lives 15 minutes, longer than a subject's cases). A failed
        // login fails the subject's cases without trying again for each of them.
        let made: Promise<BackendContractSubject> | null = null;
        defineBackendContract(`real backend, ${variant.name}, ${role} (OAuth login)`, () => {
            made ??= (async () => {
                const box = sandboxes.get(variant.key)![role];
                return subject(variant, box, role === 'admin', await loginOn(box));
            })();
            return made;
        });
    }
}

describe('ChurchTools OAuth, measured on the test instance', () => {
    it('refuses to exchange a code without the client secret (invalid_request) or with a wrong one (invalid_client)', async () => {
        const cases: [secret: string | null, status: number, error: string][] = [
            [null, 400, 'invalid_request'],
            [`${client.secret.slice(0, -1)}${client.secret.endsWith('x') ? 'y' : 'x'}`, 401, 'invalid_client'],
        ];
        for (const [secret, status, error] of cases) {
            const answer = await exchangeCode(env, client.identifier, secret, client.redirectUri, await freshCode());
            expect(answer.status, redactBody(answer.text)).toBe(status);
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
        // The app's client sends one request of every kind here (independent of the other cases): its methods and
        // its non-safelisted headers (Accept is safelisted) must pass the browser's CORS check.
        sandbox.seen.length = 0;
        const token = sandbox.mintToken(env.normal.id, env.normal.username, false);
        const user = api(() => token);
        await user.getEntry(env.normal.id);
        await user.deleteEntry(env.normal.id, WIRE_VARIANT.settings.requirePasswordForPasswordChange ? env.normal.pwd : undefined);
        await expect(user.putEntry(env.normal.id, { secondaryPwd: 'abc' })).rejects.toMatchObject({
            slug: expect.stringMatching(/^(password-invalid|custom-password-not-allowed|primary-password-required)$/),
        });
        await expect(user.selfTest()).rejects.toMatchObject({ slug: 'forbidden' });
        await expect(api(() => null).login('not-a-code', 'verifier', client.redirectUri)).rejects.toMatchObject({ slug: 'oauth-code-invalid' });
        expect(new Set(sandbox.seen.map((r) => r.method.toUpperCase()))).toEqual(new Set(['GET', 'DELETE', 'PUT', 'POST']));
        expect(sandbox.seen.some((r) => r.headerNames.includes('authorization')) && sandbox.seen.some((r) => r.headerNames.includes('content-type'))).toBe(true);
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
