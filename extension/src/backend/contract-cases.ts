import { describe, expect, it } from 'vitest';
import type { BackendApi } from './api';
import { BackendProblem } from './problems';

/**
 * What a contract run needs. The cases are written once and run against the fake now and against the real test
 * backend in Task 18. Optional members mark what a subject cannot offer; the cases that need them are skipped.
 */
export type BackendContractSubject = BackendApi & {
    /** The person the subject acts as. */
    ownPersonId: number;
    /** Whether that person is an admin (`selfTest` and other persons' entries depend on it). */
    admin: boolean;
    /** Another existing person (a non-admin may not touch its entry). */
    otherPersonId: number;
    /** The caller's ChurchTools password, when the backend requires it for changes. `null`: not required. */
    primaryPwd: string | null;
    /** Whether custom passwords are allowed. */
    allowCustomPassword: boolean;
    /** The setting `passwordLength` (12 to 64). */
    passwordLength: number;
    /** Valid arguments of one login, when the subject can produce them. */
    loginArguments?: () => Promise<[code: string, codeVerifier: string, redirectUri: string]>;
    /** An API whose token is missing or expired; every call gives the matching problem. */
    withoutToken?: () => BackendApi;
};

/** `ok` is a password every policy of the backend accepts (letter, digit, symbol, 12 to 64 characters). */
const ok = 'Contract-Pass-1234';

async function problemOf(call: Promise<unknown>): Promise<BackendProblem> {
    const error = await call.then(
        () => null,
        (e: unknown) => e,
    );
    expect(error, 'expected a BackendProblem').toBeInstanceOf(BackendProblem);
    return error as BackendProblem;
}

export function defineBackendContract(name: string, make: () => Promise<BackendContractSubject>): void {
    describe(`Backend contract: ${name}`, () => {
        it('login answers the documented shape', async (ctx) => {
            const s = await make();
            if (!s.loginArguments) return ctx.skip();
            const result = await s.login(...(await s.loginArguments()));
            expect(result.accessToken.length).toBeGreaterThan(0);
            expect(result.expiresIn).toBe(900);
            expect(typeof result.admin).toBe('boolean');
            expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
        });

        it('login with a bad code gives oauth-code-invalid (400)', async (ctx) => {
            const s = await make();
            if (!s.loginArguments) return ctx.skip();
            const [, verifier, redirect] = await s.loginArguments();
            expect(await problemOf(s.login('not-a-valid-code', verifier, redirect))).toMatchObject({ slug: 'oauth-code-invalid', status: 400 });
        });

        it('a call without a valid token gives a token problem (401)', async (ctx) => {
            const s = await make();
            if (!s.withoutToken) return ctx.skip();
            const p = await problemOf(s.withoutToken().getEntry(s.ownPersonId));
            expect(p.status).toBe(401);
            expect(['missing-token', 'invalid-token', 'token-expired']).toContain(p.slug);
        });

        it('GET without an entry is "none" (404 entry-not-found), idempotent DELETE gives 204', async () => {
            const s = await make();
            await s.deleteEntry(s.ownPersonId, s.primaryPwd ?? undefined);
            await s.deleteEntry(s.ownPersonId, s.primaryPwd ?? undefined);
            expect(await s.getEntry(s.ownPersonId)).toBe('none');
        });

        it('a generated password comes back once (200) and is then stored', async () => {
            const s = await make();
            const body = s.primaryPwd === null ? {} : { primaryPwd: s.primaryPwd };
            const { generated } = await s.putEntry(s.ownPersonId, body);
            try {
                expect(typeof generated).toBe('string');
                expect(generated!.length).toBe(s.passwordLength);
                expect(generated).toMatch(/^[A-Za-z0-9!@$%&*\-_+=?.]+$/);
                expect(generated).toMatch(/[A-Za-z]/);
                expect(generated).toMatch(/[0-9]/);
                expect(generated).toMatch(/[!@$%&*\-_+=?.]/);
                expect(await s.getEntry(s.ownPersonId)).toBe('set');
            } finally {
                await s.deleteEntry(s.ownPersonId, s.primaryPwd ?? undefined);
            }
        });

        it('a custom password is stored with 204 and never echoed', async (ctx) => {
            const s = await make();
            if (!s.allowCustomPassword) return ctx.skip();
            const result = await s.putEntry(s.ownPersonId, { ...(s.primaryPwd === null ? {} : { primaryPwd: s.primaryPwd }), secondaryPwd: ok });
            try {
                expect(result).toEqual({});
                expect(await s.getEntry(s.ownPersonId)).toBe('set');
            } finally {
                await s.deleteEntry(s.ownPersonId, s.primaryPwd ?? undefined);
            }
        });

        it('password-invalid (400) lists the violated rules', async (ctx) => {
            const s = await make();
            if (!s.allowCustomPassword) return ctx.skip();
            const primary = s.primaryPwd === null ? {} : { primaryPwd: s.primaryPwd };
            const p = await problemOf(s.putEntry(s.ownPersonId, { ...primary, secondaryPwd: 'abc' }));
            expect(p).toMatchObject({ slug: 'password-invalid', status: 400 });
            expect([...(p.violations ?? [])].sort()).toEqual(['missing-digit', 'missing-symbol', 'too-short']);
            const q = await problemOf(s.putEntry(s.ownPersonId, { ...primary, secondaryPwd: 'Abc 123456789!!!' }));
            expect(q.violations).toEqual(['invalid-character']);
            const r = await problemOf(s.putEntry(s.ownPersonId, { ...primary, secondaryPwd: '1234567890123456!' }));
            expect(r.violations).toEqual(['missing-letter']);
            const t = await problemOf(s.putEntry(s.ownPersonId, { ...primary, secondaryPwd: `a1!${'x'.repeat(126)}` }));
            expect(t.violations).toEqual(['too-long']);
            expect(await s.getEntry(s.ownPersonId).catch(() => 'error')).not.toBe('error');
        });

        it('primary-password-required (400) and invalid-primary-password (403)', async (ctx) => {
            const s = await make();
            if (s.primaryPwd === null) return ctx.skip();
            expect(await problemOf(s.putEntry(s.ownPersonId, {}))).toMatchObject({ slug: 'primary-password-required', status: 400 });
            expect(await problemOf(s.putEntry(s.ownPersonId, { primaryPwd: '' }))).toMatchObject({ slug: 'primary-password-required', status: 400 });
            expect(await problemOf(s.putEntry(s.ownPersonId, { primaryPwd: `${s.primaryPwd}-wrong` }))).toMatchObject({
                slug: 'invalid-primary-password',
                status: 403,
            });
            expect(await problemOf(s.deleteEntry(s.ownPersonId))).toMatchObject({ slug: 'primary-password-required', status: 400 });
            expect(await problemOf(s.deleteEntry(s.ownPersonId, `${s.primaryPwd}-wrong`))).toMatchObject({
                slug: 'invalid-primary-password',
                status: 403,
            });
        });

        it('another person\'s entry gives forbidden (403) for a non-admin', async (ctx) => {
            const s = await make();
            if (s.admin) return ctx.skip();
            for (const call of [s.getEntry(s.otherPersonId), s.putEntry(s.otherPersonId, {}), s.deleteEntry(s.otherPersonId)]) {
                expect(await problemOf(call)).toMatchObject({ slug: 'forbidden', status: 403 });
            }
        });

        it('selfTest is for admins only', async () => {
            const s = await make();
            if (!s.admin) {
                expect(await problemOf(s.selfTest())).toMatchObject({ slug: 'forbidden', status: 403 });
                return;
            }
            const result = await s.selfTest();
            expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
            expect(result.tests.length).toBeGreaterThan(0);
            for (const t of result.tests) expect(['ok', 'fail']).toContain(t.status);
        });
    });
}
