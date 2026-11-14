// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContractSetupError, loadContractEnv, missingPrerequisites, type SetupDeps } from './setup';

const TOKEN = 'dummy-login-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PWD = 'fixture-password-Zz9!';
const GOOD = { CT_API_URL: 'https://test.church.tools/api', CT_API_TOKEN: TOKEN };

let dir: string;
let deps: SetupDeps;

const write = (name: string, value: unknown) => fs.writeFileSync(path.join(dir, 'fixtures', name), typeof value === 'string' ? value : JSON.stringify(value));

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-setup-'));
    fs.mkdirSync(path.join(dir, 'fixtures'));
    fs.mkdirSync(path.join(dir, 'backend/vendor'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'backend/vendor/autoload.php'), '<?php');
    write('admin_users.json', [{ id: 1, username: 'admin', pwd: PWD }]);
    write('normal_users.json', [{ id: 947, username: 'normal', pwd: PWD }]);
    write('person_status.json', { active: 2, archived: 3, deleted: 4 });
    deps = { fixturesDir: path.join(dir, 'fixtures'), backendDir: path.join(dir, 'backend'), phpAvailable: () => true };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('missingPrerequisites', () => {
    it('is empty when everything is there', () => {
        expect(missingPrerequisites(GOOD, deps)).toEqual([]);
    });

    it('names both variables when both are missing, and an empty string counts as missing', () => {
        for (const env of [{}, { CT_API_URL: '', CT_API_TOKEN: '' }]) {
            const missing = missingPrerequisites(env, deps).join('\n');
            expect(missing).toMatch(/CT_API_URL/);
            expect(missing).toMatch(/CT_API_TOKEN/);
        }
    });

    it('names only the one that is missing', () => {
        expect(missingPrerequisites({ CT_API_URL: GOOD.CT_API_URL }, deps)).toEqual([expect.stringMatching(/CT_API_TOKEN/)]);
        expect(missingPrerequisites({ CT_API_TOKEN: TOKEN }, deps)).toEqual([expect.stringMatching(/CT_API_URL/)]);
    });

    it('refuses an address that is not https://<instance>/api', () => {
        for (const url of [
            'http://test.church.tools/api',
            'https://user:pw@test.church.tools/api',
            'https://user@test.church.tools/api',
            'https://:pw@test.church.tools/api',
            'https://test.church.tools/',
            'https://test.church.tools/apix',
            'https://test.church.tools/x/api',
            'https://test.church.tools/api?x=1',
            'https://test.church.tools/api#x',
            'not a url',
        ]) {
            expect(missingPrerequisites({ ...GOOD, CT_API_URL: url }, deps), url).toEqual([expect.stringMatching(/CT_API_URL as https:\/\/<instance>\/api/)]);
        }
    });

    it('accepts a trailing slash', () => {
        expect(missingPrerequisites({ ...GOOD, CT_API_URL: 'https://test.church.tools/api/' }, deps)).toEqual([]);
    });

    it('names a missing fixture, vendor folder and php', () => {
        fs.rmSync(path.join(dir, 'fixtures/normal_users.json'));
        fs.rmSync(path.join(dir, 'backend/vendor'), { recursive: true });
        const missing = missingPrerequisites(GOOD, { ...deps, phpAvailable: () => false }).join('\n');
        expect(missing).toMatch(/normal_users\.json/);
        expect(missing).toMatch(/backend\/vendor/);
        expect(missing).toMatch(/php/);
    });

    it('names a fixture without a usable first user', () => {
        for (const bad of [[], [{ id: 947, username: 'x' }], [{ id: '947', username: 'x', pwd: PWD }], [{ id: 0, username: 'x', pwd: PWD }], [{ id: 947, username: '', pwd: PWD }], [{ id: 947, username: 'x', pwd: '' }], { id: 947, username: 'x', pwd: PWD }, '{broken']) {
            write('normal_users.json', bad);
            expect(missingPrerequisites(GOOD, deps), JSON.stringify(bad)).toEqual([expect.stringMatching(/first user .*normal_users\.json/)]);
        }
    });

    it('names person_status ids that are 0, negative or absent', () => {
        for (const bad of [{ active: 0, archived: 3, deleted: 4 }, { active: 2, archived: -3, deleted: 4 }, { active: 2, archived: 3 }]) {
            write('person_status.json', bad);
            expect(missingPrerequisites(GOOD, deps), JSON.stringify(bad)).toEqual([expect.stringMatching(/person_status\.json/)]);
        }
    });
});

describe('loadContractEnv', () => {
    it('returns the configuration without a trailing slash', () => {
        const env = loadContractEnv({ ...GOOD, CT_API_URL: 'https://test.church.tools/api/' }, deps);
        expect(env).toMatchObject({ apiUrl: 'https://test.church.tools/api', root: 'https://test.church.tools', host: 'test.church.tools', apiToken: TOKEN, persons: { active: 2, archived: 3, deleted: 4 } });
        expect(env.normal).toEqual({ id: 947, username: 'normal', pwd: PWD });
    });

    it('throws one ContractSetupError naming everything, never the token or a password', () => {
        write('admin_users.json', [{ id: 1, username: 'admin' }]);
        const error = (() => {
            try {
                loadContractEnv({ CT_API_URL: 'http://test.church.tools/api', CT_API_TOKEN: TOKEN }, { ...deps, phpAvailable: () => false });
            } catch (e) {
                return e;
            }
        })();
        expect(error).toBeInstanceOf(ContractSetupError);
        const message = (error as Error).message;
        expect(message).toMatch(/CT_API_URL as https/);
        expect(message).toMatch(/admin_users\.json/);
        expect(message).toMatch(/php/);
        expect(message).not.toContain(TOKEN);
        expect(message).not.toContain(PWD);
    });
});
