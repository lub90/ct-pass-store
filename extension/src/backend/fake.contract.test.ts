import { describe, expect, it } from 'vitest';
import { createFakeBackend, type FakeBackendOptions } from '@/dev/fake-backend';
import { defineBackendContract, type BackendContractSubject } from './contract-cases';
import { BackendProblem } from './problems';

const PRIMARY = 'ct-Secret-1';
const REDIRECT = 'https://ct.example/ccm/ctpassstore/auth/callback';

const subject = (over: FakeBackendOptions = {}): BackendContractSubject => {
    const fake = createFakeBackend({ personId: 1, existingPersonIds: [1, 2, 3], primaryPassword: PRIMARY, ...over });
    return {
        ...fake,
        ownPersonId: 1,
        otherPersonId: 2,
        admin: over.admin ?? false,
        primaryPwd: (over.requirePasswordForPasswordChange ?? true) ? PRIMARY : null,
        allowCustomPassword: over.allowCustomPassword ?? true,
        passwordLength: over.passwordLength ?? 12,
        gonePersonId: 99,
        loginArguments: async () => ['valid-code', 'verifier', REDIRECT],
        withoutToken: () => createFakeBackend({ personId: 1, loggedIn: false }),
        expiredToken: () => {
            const expired = createFakeBackend({ personId: 1 });
            expired.expireToken();
            return expired;
        },
        getEntryRaw: (id) => fake.getEntryRaw(id),
    };
};

/** Calls that carried a deliberately wrong primary password (`…-wrong`), per subject; checked after the contracts. */
const wrongSent = new Map<string, number>();
const counting = (label: string, s: BackendContractSubject): BackendContractSubject => {
    wrongSent.set(label, wrongSent.get(label) ?? 0);
    const count = (pwd?: string) => {
        if (pwd !== undefined && pwd !== PRIMARY && pwd.endsWith('-wrong')) wrongSent.set(label, (wrongSent.get(label) ?? 0) + 1);
    };
    return {
        ...s,
        putEntry: (id, body) => (count(body.primaryPwd), s.putEntry(id, body)),
        deleteEntry: (id, pwd) => (count(pwd), s.deleteEntry(id, pwd)),
    };
};

defineBackendContract('fake, user', async () => counting('default', subject()));
defineBackendContract('fake, user, without the wrong-primary-password cases', async () => counting('off', { ...subject(), wrongPrimaryPasswordCases: false }));

describe('wrongPrimaryPasswordCases', () => {
    it('false skips both wrong-primary-password cases; unset runs them (3 wrong passwords: PUT, DELETE, order of checks)', () => {
        expect(wrongSent.get('off')).toBe(0);
        expect(wrongSent.get('default')).toBe(3);
    });
});
defineBackendContract('fake, admin', async () => subject({ admin: true }));
defineBackendContract('fake, user, custom passwords, length 20', async () => subject({ passwordLength: 20 }));
defineBackendContract('fake, admin, length 64', async () => subject({ admin: true, passwordLength: 64 }));
defineBackendContract('fake, no primary password, no custom passwords, length 20', async () =>
    subject({ requirePasswordForPasswordChange: false, allowCustomPassword: false, passwordLength: 20 }),
);

const problem = async (call: Promise<unknown>) => (await call.then(() => null, (e: unknown) => e)) as BackendProblem;

describe('fake backend rules', () => {
    const make = (over: FakeBackendOptions = {}) => createFakeBackend({ personId: 1, existingPersonIds: [1, 2, 3], primaryPassword: PRIMARY, ...over });

    it('login: version and admin come from the options, a code is used once', async () => {
        const fake = make({ admin: true, version: '2.3.4', loggedIn: false });
        const args: [string, string, string] = ['valid-code', 'v', REDIRECT];
        await expect(fake.getEntry(1)).rejects.toMatchObject({ slug: 'missing-token', status: 401 });
        expect(await fake.login(...args)).toEqual({ accessToken: expect.any(String), expiresIn: 900, admin: true, version: '2.3.4' });
        expect(await fake.getEntry(1)).toBe('none');
        expect(await problem(fake.login(...args))).toMatchObject({ slug: 'oauth-code-invalid', status: 400 });
        for (const bad of [['', 'v', REDIRECT], ['c', '', REDIRECT], ['c', 'v', '']] as [string, string, string][]) {
            expect(await problem(fake.login(...bad))).toMatchObject({ slug: 'invalid-body', status: 400 });
        }
    });

    it('login: redirectUri must be https on the ChurchTools host and port; fields at most 2,048 characters', async () => {
        const bad = [
            'http://ct.example/cb',
            'https://ct.example.evil.com/cb',
            'https://ct.example@evil.com/cb',
            'https://evil.com/cb',
            'https://ct.example:8443/cb',
            'not a url',
            `${REDIRECT}?${'a'.repeat(2048)}`,
        ];
        for (const redirectUri of bad) {
            const fake = make({ loggedIn: false });
            expect(await problem(fake.login('valid-code', 'v', redirectUri)), redirectUri).toMatchObject({ slug: 'invalid-body', status: 400 });
            // the code is not used up by a rejected request
            expect(await fake.login('valid-code', 'v', REDIRECT)).toMatchObject({ expiresIn: 900 });
        }
        const fake = make({ loggedIn: false, validCodes: ['c'.repeat(2048)] });
        expect(await problem(fake.login('c'.repeat(2049), 'v', REDIRECT))).toMatchObject({ slug: 'invalid-body' });
        expect(await problem(fake.login('c', 'v'.repeat(2049), REDIRECT))).toMatchObject({ slug: 'invalid-body' });
        expect(await fake.login('c'.repeat(2048), 'v'.repeat(2048), REDIRECT)).toMatchObject({ expiresIn: 900 });
    });

    it('login: a person without the extension right gets no-service-access', async () => {
        const fake = make({ loggedIn: false, noServiceAccess: true });
        expect(await problem(fake.login('valid-code', 'v', REDIRECT))).toMatchObject({ slug: 'no-service-access', status: 403 });
    });

    it('order of checks: token, id, authorization, existence, primary password, custom allowed, policy', async () => {
        const fake = make({ allowCustomPassword: false });
        // authorization before existence: person 99 is unknown but a user gets forbidden, not person-not-found
        expect((await problem(fake.getEntry(99))).slug).toBe('forbidden');
        // wrong primary password beats custom-password-not-allowed and the policy
        expect((await problem(fake.putEntry(1, { primaryPwd: 'x', secondaryPwd: 'a' }))).slug).toBe('invalid-primary-password');
        expect((await problem(fake.putEntry(1, { primaryPwd: PRIMARY, secondaryPwd: 'a' }))).slug).toBe('custom-password-not-allowed');
        // an empty custom password counts as present
        expect((await problem(fake.putEntry(1, { primaryPwd: PRIMARY, secondaryPwd: '' }))).slug).toBe('custom-password-not-allowed');
        const allowed = make();
        expect((await problem(allowed.putEntry(1, { primaryPwd: PRIMARY, secondaryPwd: '' }))).violations).toContain('too-short');
        // the ID check is before authorization
        expect(await problem(fake.getEntry(0))).toMatchObject({ slug: 'invalid-id', status: 400 });
    });

    it('invalid-id comes before forbidden; ids are strict decimal', async () => {
        const fake = make();
        for (const id of ['0', '01', '-1', '1.5', '1e3', 'abc', '+1', ' 1', '9223372036854775808']) {
            expect(await problem(fake.getEntryRaw(id)), id).toMatchObject({ slug: 'invalid-id', status: 400 });
        }
        expect(await fake.getEntryRaw('1')).toBe('none');
        expect((await problem(fake.getEntryRaw('2'))).slug).toBe('forbidden');
    });

    it('an admin gets person-not-found for a gone person on GET and PUT, but may DELETE', async () => {
        const fake = make({ admin: true });
        expect(await problem(fake.getEntry(99))).toMatchObject({ slug: 'person-not-found', status: 404 });
        expect(await problem(fake.putEntry(99, { primaryPwd: PRIMARY }))).toMatchObject({ slug: 'person-not-found', status: 404 });
        // a wrong primary password comes before the existence check
        expect((await problem(fake.putEntry(99, { primaryPwd: 'x' }))).slug).toBe('invalid-primary-password');
        await expect(fake.deleteEntry(99, PRIMARY)).resolves.toBeUndefined();
        // the admin's own entry needs no existence check
        expect(await make({ admin: true, existingPersonIds: [] }).getEntry(1)).toBe('none');
    });

    it('an admin may act on others, a user may not, and the primary password is the caller\'s', async () => {
        const admin = make({ admin: true });
        expect((await admin.putEntry(2, { primaryPwd: PRIMARY })).generated).toMatch(/\S{12}/);
        expect(await admin.getEntry(2)).toBe('set');
        await admin.deleteEntry(2, PRIMARY);
        expect(await admin.getEntry(2)).toBe('none');
        expect((await problem(make().getEntry(2))).slug).toBe('forbidden');
    });

    it('seeded entries are readable and deleting removes them', async () => {
        const fake = make({ entries: { 1: 'Seed-pass-1!' } });
        expect(await fake.getEntry(1)).toBe('set');
        await fake.deleteEntry(1, PRIMARY);
        expect(await fake.getEntry(1)).toBe('none');
    });

    it('a failed write leaves the entry as it was', async () => {
        const fake = make({ entries: { 1: 'Seed-pass-1!' } });
        await problem(fake.putEntry(1, { primaryPwd: PRIMARY, secondaryPwd: 'bad' }));
        expect(fake.entries.get(1)).toBe('Seed-pass-1!');
    });

    it('generated passwords differ and have the configured length', async () => {
        const fake = make({ passwordLength: 64, requirePasswordForPasswordChange: false });
        const a = (await fake.putEntry(1, {})).generated!;
        const b = (await fake.putEntry(1, {})).generated!;
        expect(a).toHaveLength(64);
        expect(a).not.toBe(b);
    });

    it('too-long counts bytes: 127 ASCII characters plus "ä" are 129 bytes', async () => {
        const fake = make({ requirePasswordForPasswordChange: false });
        expect((await problem(fake.putEntry(1, { secondaryPwd: `a1!${'x'.repeat(124)}ä` }))).violations).toEqual(['too-long']);
    });

    it('policy boundaries: length exactly passwordLength passes, one less fails; 128 passes, 129 is too-long', async () => {
        const fake = make({ requirePasswordForPasswordChange: false, passwordLength: 12 });
        await expect(fake.putEntry(1, { secondaryPwd: 'abcdefghij1!' })).resolves.toEqual({});
        expect((await problem(fake.putEntry(1, { secondaryPwd: 'abcdefghi1!' }))).violations).toEqual(['too-short']);
        await expect(fake.putEntry(1, { secondaryPwd: `a1!${'x'.repeat(125)}` })).resolves.toEqual({});
        expect((await problem(fake.putEntry(1, { secondaryPwd: `a1!${'x'.repeat(126)}` }))).violations).toEqual(['too-long']);
        // allowed symbols all pass, a few others do not
        for (const c of '!@$%&*-_+=?.') await expect(fake.putEntry(1, { secondaryPwd: `abcdefghij1${c}` })).resolves.toEqual({});
        for (const c of ['#', ' ', 'ä', '€', '/', '"']) {
            expect((await problem(fake.putEntry(1, { secondaryPwd: `abcdefghij1!${c}` }))).violations, c).toEqual(['invalid-character']);
        }
    });

    it('expireToken gives token-expired until the next login', async () => {
        const fake = make();
        fake.expireToken();
        expect(await problem(fake.getEntry(1))).toMatchObject({ slug: 'token-expired', status: 401 });
        await fake.login('valid-code', 'v', REDIRECT);
        expect(await fake.getEntry(1)).toBe('none');
    });

    it('failNext fails exactly one call with the given problem, with retryAfter', async () => {
        const fake = make();
        fake.failNext('too-many-attempts', 429, { retryAfter: 120 });
        expect(await problem(fake.getEntry(1))).toMatchObject({ slug: 'too-many-attempts', status: 429, retryAfter: 120 });
        expect(await fake.getEntry(1)).toBe('none');
    });

    it('settings can change while running (setSettings)', async () => {
        const fake = make();
        fake.setSettings({ allowCustomPassword: false });
        expect((await problem(fake.putEntry(1, { primaryPwd: PRIMARY, secondaryPwd: 'Abcdefgh1234!' }))).slug).toBe('custom-password-not-allowed');
    });

    it('selfTest: 403 forbidden for users; write adds a check', async () => {
        expect((await problem(make().selfTest())).slug).toBe('forbidden');
        const admin = make({ admin: true, version: '3.0.0' });
        const plain = await admin.selfTest();
        const write = await admin.selfTest(true);
        expect(plain.version).toBe('3.0.0');
        expect(write.tests.length).toBe(plain.tests.length + 1);
    });
});
