import { describe, expect, it } from 'vitest';
import type { BackendApi } from './api';
import { tokenPerson } from './jwt';
import { BackendProblem } from './problems';

/**
 * What a contract run needs. The cases are written once and run against the fake now and against the real test
 * backend in Task 18, so they keep the fake honest. Optional members mark what a subject cannot offer; the cases
 * that need them are skipped.
 */
export type BackendContractSubject = BackendApi & {
    /** The person the subject acts as. */
    ownPersonId: number;
    /** Whether that person is an admin (`selfTest` and other persons' entries depend on it). */
    admin: boolean;
    /** Another existing person (a non-admin may not touch its entry). */
    otherPersonId: number;
    /** An id that belongs to no (or an archived) person in ChurchTools. */
    gonePersonId?: number;
    /** The caller's ChurchTools password, when the backend requires it for changes. `null`: not required. */
    primaryPwd: string | null;
    /** Whether custom passwords are allowed. */
    allowCustomPassword: boolean;
    /** The setting `passwordLength` (12 to 64). */
    passwordLength: number;
    /** Valid arguments of one login, when the subject can produce them. */
    loginArguments?: () => Promise<[code: string, codeVerifier: string, redirectUri: string]>;
    /** An API whose token is missing; every call gives `missing-token` (or another 401 token problem). */
    withoutToken?: () => BackendApi;
    /** An API whose token is valid but has expired. */
    expiredToken?: () => BackendApi;
    /** `GET /v1/entries/{id}` with the id exactly as given (the typed API refuses bad ids itself). */
    getEntryRaw?: (id: string) => Promise<'set' | 'none'>;
};

const SYMBOLS = '!@$%&*-_+=?.';

/** A valid password of exactly `length` characters (a letter, a digit and a symbol, the rest letters). */
export const validPassword = (length: number): string => `a1!${'x'.repeat(length - 3)}`;

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
        const primary = (s: BackendContractSubject) => (s.primaryPwd === null ? {} : { primaryPwd: s.primaryPwd });
        const clean = async (s: BackendContractSubject, id = s.ownPersonId) => s.deleteEntry(id, s.primaryPwd ?? undefined);

        it('login answers the documented shape, with the expected admin flag', async (ctx) => {
            const s = await make();
            if (!s.loginArguments) return ctx.skip();
            const result = await s.login(...(await s.loginArguments()));
            expect(result.accessToken.length).toBeGreaterThan(0);
            // The extension binds the stored token to the ChurchTools person by this claim.
            expect(tokenPerson(result.accessToken)).toBe(s.ownPersonId);
            expect(result.expiresIn).toBe(900);
            expect(result.admin).toBe(s.admin);
            expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
        });

        it('login with a bad code gives oauth-code-invalid (400)', async (ctx) => {
            const s = await make();
            if (!s.loginArguments) return ctx.skip();
            const [, verifier, redirect] = await s.loginArguments();
            expect(await problemOf(s.login('not-a-valid-code', verifier, redirect))).toMatchObject({ slug: 'oauth-code-invalid', status: 400 });
        });

        it('a call without a token gives a token problem (401)', async (ctx) => {
            const s = await make();
            if (!s.withoutToken) return ctx.skip();
            const p = await problemOf(s.withoutToken().getEntry(s.ownPersonId));
            expect(p.status).toBe(401);
            expect(['missing-token', 'invalid-token']).toContain(p.slug);
        });

        it('an expired token gives token-expired (401)', async (ctx) => {
            const s = await make();
            if (!s.expiredToken) return ctx.skip();
            expect(await problemOf(s.expiredToken().getEntry(s.ownPersonId))).toMatchObject({ slug: 'token-expired', status: 401 });
        });

        it('GET without an entry is "none" (404 entry-not-found), idempotent DELETE gives 204', async () => {
            const s = await make();
            await clean(s);
            await clean(s);
            expect(await s.getEntry(s.ownPersonId)).toBe('none');
        });

        it('a generated password comes back once (200) and is then stored', async () => {
            const s = await make();
            const { generated } = await s.putEntry(s.ownPersonId, primary(s));
            try {
                expect(typeof generated).toBe('string');
                expect(generated!.length).toBe(s.passwordLength);
                expect(generated).toMatch(/^[A-Za-z0-9!@$%&*\-_+=?.]+$/);
                expect(generated).toMatch(/[A-Za-z]/);
                expect(generated).toMatch(/[0-9]/);
                expect(generated).toMatch(/[!@$%&*\-_+=?.]/);
                expect(await s.getEntry(s.ownPersonId)).toBe('set');
            } finally {
                await clean(s);
            }
        });

        it('a custom password of exactly passwordLength (and of 128 characters) is stored with 204 and never echoed', async (ctx) => {
            const s = await make();
            if (!s.allowCustomPassword) return ctx.skip();
            try {
                for (const length of [s.passwordLength, 128]) {
                    await clean(s);
                    expect(await s.putEntry(s.ownPersonId, { ...primary(s), secondaryPwd: validPassword(length) })).toEqual({});
                    expect(await s.getEntry(s.ownPersonId)).toBe('set');
                }
                for (const symbol of SYMBOLS) {
                    expect(await s.putEntry(s.ownPersonId, { ...primary(s), secondaryPwd: `${validPassword(s.passwordLength - 1)}${symbol}` })).toEqual({});
                }
            } finally {
                await clean(s);
            }
        });

        it('password-invalid (400) lists the violated rules and writes nothing', async (ctx) => {
            const s = await make();
            if (!s.allowCustomPassword) return ctx.skip();
            const len = s.passwordLength;
            await clean(s);
            const violations = async (secondaryPwd: string) => {
                const p = await problemOf(s.putEntry(s.ownPersonId, { ...primary(s), secondaryPwd }));
                expect(p).toMatchObject({ slug: 'password-invalid', status: 400 });
                return [...(p.violations ?? [])].sort();
            };
            expect(await violations('abc')).toEqual(['missing-digit', 'missing-symbol', 'too-short']);
            expect(await violations(validPassword(len - 1))).toEqual(['too-short']);
            expect(await violations(`a1! ${'x'.repeat(len)}`)).toEqual(['invalid-character']);
            expect(await violations(`${'1'.repeat(len - 1)}!`)).toEqual(['missing-letter']);
            expect(await violations(`${'a'.repeat(len - 1)}!`)).toEqual(['missing-digit']);
            expect(await violations(`${'a'.repeat(len - 1)}1`)).toEqual(['missing-symbol']);
            expect(await violations(validPassword(129))).toEqual(['too-long']);
            expect(await s.getEntry(s.ownPersonId)).toBe('none');
        });

        it('custom-password-not-allowed (400) when custom passwords are off, before the policy; writes nothing', async (ctx) => {
            const s = await make();
            if (s.allowCustomPassword) return ctx.skip();
            await clean(s);
            for (const secondaryPwd of [validPassword(s.passwordLength), 'abc', '']) {
                expect(await problemOf(s.putEntry(s.ownPersonId, { ...primary(s), secondaryPwd }))).toMatchObject({
                    slug: 'custom-password-not-allowed',
                    status: 400,
                });
            }
            expect(await s.getEntry(s.ownPersonId)).toBe('none');
        });

        it('primary-password-required (400) and invalid-primary-password (403), nothing written or deleted', async (ctx) => {
            const s = await make();
            if (s.primaryPwd === null) return ctx.skip();
            await clean(s);
            const wrong = `${s.primaryPwd}-wrong`;
            expect(await problemOf(s.putEntry(s.ownPersonId, {}))).toMatchObject({ slug: 'primary-password-required', status: 400 });
            expect(await problemOf(s.putEntry(s.ownPersonId, { primaryPwd: '' }))).toMatchObject({ slug: 'primary-password-required', status: 400 });
            expect(await problemOf(s.putEntry(s.ownPersonId, { primaryPwd: wrong }))).toMatchObject({ slug: 'invalid-primary-password', status: 403 });
            expect(await s.getEntry(s.ownPersonId)).toBe('none');
            await s.putEntry(s.ownPersonId, primary(s));
            try {
                expect(await problemOf(s.deleteEntry(s.ownPersonId))).toMatchObject({ slug: 'primary-password-required', status: 400 });
                expect(await problemOf(s.deleteEntry(s.ownPersonId, wrong))).toMatchObject({ slug: 'invalid-primary-password', status: 403 });
                expect(await s.getEntry(s.ownPersonId)).toBe('set');
            } finally {
                await clean(s);
            }
        });

        it('a wrong primary password beats a bad or forbidden custom password (order of checks)', async (ctx) => {
            const s = await make();
            if (s.primaryPwd === null) return ctx.skip();
            await clean(s);
            const wrong = `${s.primaryPwd}-wrong`;
            expect(await problemOf(s.putEntry(s.ownPersonId, { primaryPwd: wrong, secondaryPwd: 'abc' }))).toMatchObject({
                slug: 'invalid-primary-password',
            });
            expect(await problemOf(s.putEntry(s.ownPersonId, { secondaryPwd: 'abc' }))).toMatchObject({ slug: 'primary-password-required' });
            expect(await s.getEntry(s.ownPersonId)).toBe('none');
        });

        it('a non-admin gets forbidden (403) for another person\'s entry, also for an unknown id', async (ctx) => {
            const s = await make();
            if (s.admin) return ctx.skip();
            for (const id of [s.otherPersonId, ...(s.gonePersonId === undefined ? [] : [s.gonePersonId])]) {
                // One call at a time: started together, a later rejection would go unhandled while the first is awaited.
                for (const call of [() => s.getEntry(id), () => s.putEntry(id, primary(s)), () => s.deleteEntry(id, s.primaryPwd ?? undefined)]) {
                    expect(await problemOf(call()), String(id)).toMatchObject({ slug: 'forbidden', status: 403 });
                }
            }
        });

        it('invalid-id (400) comes before forbidden and before everything about the entry', async (ctx) => {
            const s = await make();
            if (!s.getEntryRaw) return ctx.skip();
            for (const id of ['0', '01', '-1', '1.5', '1e3', 'abc', '+1', ' 1']) {
                expect(await problemOf(s.getEntryRaw(id)), id).toMatchObject({ slug: 'invalid-id', status: 400 });
            }
        });

        it('an admin may read, write and delete another person\'s entry', async (ctx) => {
            const s = await make();
            if (!s.admin) return ctx.skip();
            const id = s.otherPersonId;
            try {
                await clean(s, id);
                expect(await s.getEntry(id)).toBe('none');
                expect((await s.putEntry(id, primary(s))).generated).toHaveLength(s.passwordLength);
                expect(await s.getEntry(id)).toBe('set');
                await clean(s, id);
                expect(await s.getEntry(id)).toBe('none');
            } finally {
                await clean(s, id);
            }
        });

        it('a gone person gives person-not-found (404) on GET and PUT for an admin, but DELETE still gives 204', async (ctx) => {
            const s = await make();
            if (!s.admin || s.gonePersonId === undefined) return ctx.skip();
            const id = s.gonePersonId;
            expect(await problemOf(s.getEntry(id))).toMatchObject({ slug: 'person-not-found', status: 404 });
            expect(await problemOf(s.putEntry(id, primary(s)))).toMatchObject({ slug: 'person-not-found', status: 404 });
            await expect(clean(s, id)).resolves.toBeUndefined();
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
