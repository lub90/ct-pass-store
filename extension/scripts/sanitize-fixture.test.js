// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeFixture } from './sanitize-fixture.js';

const HOST = 'gemeinde-test.church.tools';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI5NDcifQ.c2lnbmF0dXJlLW9mLXRoZS10b2tlbg';

describe('sanitizeFixture', () => {
    it('blanks every value under a key that names a secret, at any depth and in any case', () => {
        const out = sanitizeFixture(
            {
                accessToken: 'abc',
                data: { client_secret: 's', clientSecret: 's', PASSWORD: 'p', primaryPwd: 'p', secondaryPwd: 'c', code: 'x', csrfToken: 'y' },
                list: [{ Authorization: 'Bearer z', cookie: 'k=v', loginToken: 'l' }],
            },
            { host: HOST },
        );
        expect(out).toEqual({
            accessToken: '<redacted>',
            data: {
                client_secret: '<redacted>',
                clientSecret: '<redacted>',
                PASSWORD: '<redacted>',
                primaryPwd: '<redacted>',
                secondaryPwd: '<redacted>',
                code: '<redacted>',
                csrfToken: '<redacted>',
            },
            list: [{ Authorization: '<redacted>', cookie: '<redacted>', loginToken: '<redacted>' }],
        });
    });

    it('replaces names and contact data, but keeps ids, statuses and flags', () => {
        const out = sanitizeFixture(
            { id: 947, personId: 947, groupMemberStatus: 'active', isArchived: false, firstName: 'Anna', lastName: 'Beispiel', title: 'Anna B.', name: 'Team', nickname: 'An', username: 'anna', email: 'a@b.de', mobile: '0170', phonePrivate: '1', street: 'Weg 1', initials: 'AB', cmsUserId: 'anna', birthday: '1990-01-01', login: 'anna' },
            { host: HOST },
        );
        expect(out).toEqual({
            id: 947,
            personId: 947,
            groupMemberStatus: 'active',
            isArchived: false,
            firstName: '<name>',
            lastName: '<name>',
            title: '<name>',
            name: '<name>',
            nickname: '<name>',
            username: '<name>',
            email: '<name>',
            mobile: '<name>',
            phonePrivate: '<name>',
            street: '<name>',
            initials: '<name>',
            cmsUserId: '<name>',
            birthday: '<name>',
            login: '<name>',
        });
    });

    it('replaces the instance host anywhere in a string, ignoring case', () => {
        const out = sanitizeFixture({ url: `https://${HOST.toUpperCase()}/api/persons/1`, note: `see ${HOST}` }, { host: HOST });
        expect(out).toEqual({ url: 'https://ct.example/api/persons/1', note: 'see ct.example' });
    });

    it('replaces tokens, hashes and ciphertexts found in strings under harmless keys', () => {
        const hex = 'a'.repeat(31) + 'f'.repeat(33);
        const b64 = 'QUJD'.repeat(20) + '+/==';
        const out = sanitizeFixture({ header: `Bearer ${JWT}`, fingerprint: hex, value: b64, mixed: `x ${b64} y`, short: 'abc123' }, { host: HOST });
        expect(out).toEqual({ header: 'Bearer <jwt>', fingerprint: '<hash>', value: '<hash>', mixed: 'x <hash> y', short: 'abc123' });
    });

    it('keeps URL paths such as problem types readable', () => {
        const type = 'https://github.com/lub90/ct-pass-store/blob/main/backend/docs/problems.md#entry-not-found';
        const path = '/custommodules/43/customdatacategories/397/customdatavalues';
        expect(sanitizeFixture({ type, path }, { host: HOST })).toEqual({ type, path });
    });

    it('replaces e-mail addresses found in strings', () => {
        expect(sanitizeFixture({ detail: 'mail anna.b@example.org now' }, { host: HOST })).toEqual({ detail: 'mail <email> now' });
    });

    it('sanitizes JSON inside a string value (KV values are JSON strings)', () => {
        const value = JSON.stringify({ personId: 3, secondaryPwd: 'cipher', name: 'X' });
        expect(JSON.parse(sanitizeFixture({ value }, { host: HOST }).value)).toEqual({ personId: 3, secondaryPwd: '<redacted>', name: '<name>' });
    });

    it('does not change its input', () => {
        const input = { accessToken: 'abc', nested: { firstName: 'A' } };
        sanitizeFixture(input, { host: HOST });
        expect(input).toEqual({ accessToken: 'abc', nested: { firstName: 'A' } });
    });

    it('refuses to run without a host, so the instance address cannot slip through', () => {
        expect(() => sanitizeFixture({}, {})).toThrow(/host/);
        expect(() => sanitizeFixture({}, { host: '' })).toThrow(/host/);
    });
});

describe('sanitize-fixture CLI', () => {
    let dir;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-fixture-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const script = path.join(import.meta.dirname, 'sanitize-fixture.js');

    it('writes the sanitized file with mode 600, taking the host from CT_API_URL', () => {
        const input = path.join(dir, 'in.json');
        const output = path.join(dir, 'out.json');
        fs.writeFileSync(input, JSON.stringify({ accessToken: 'abc', url: `https://${HOST}/api` }));
        const run = spawnSync(process.execPath, [script, input, output], { env: { ...process.env, CT_API_URL: `https://${HOST}/api` }, encoding: 'utf8' });
        expect(run.status, run.stderr).toBe(0);
        expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({ accessToken: '<redacted>', url: 'https://ct.example/api' });
        expect(fs.statSync(output).mode & 0o777).toBe(0o600);
    });

    it('fails without CT_API_URL and writes nothing', () => {
        const input = path.join(dir, 'in.json');
        const output = path.join(dir, 'out.json');
        fs.writeFileSync(input, '{}');
        const env = { ...process.env };
        delete env.CT_API_URL;
        const run = spawnSync(process.execPath, [script, input, output], { env, encoding: 'utf8' });
        expect(run.status).not.toBe(0);
        expect(run.stderr).toMatch(/CT_API_URL/);
        expect(fs.existsSync(output)).toBe(false);
    });
});
