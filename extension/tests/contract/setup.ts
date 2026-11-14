import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * What the contract layer needs, checked before any test runs (spec 13.2). The same source as the backend's contract
 * tests: `CT_API_URL` and `CT_API_TOKEN` as in `backend/phpunit.xml`, and the backend's gitignored fixtures with the
 * test users (`backend/tests/Contract/fixtures/`, or `CT_FIXTURES_DIR`). No password is ever an environment variable.
 * Without all of it the run aborts with a message naming every missing piece; it is never reported as passed.
 */

export const EXTENSION_DIR = path.resolve(import.meta.dirname, '../..');
export const BACKEND_DIR = path.resolve(EXTENSION_DIR, '../backend');

export interface FixtureUser {
    id: number;
    username: string;
    pwd: string;
}

export interface ContractEnv {
    /** `https://<instance>/api`, without a trailing slash. */
    apiUrl: string;
    /** `https://<instance>`. */
    root: string;
    host: string;
    /** The service user's login token (the backend's `CT_API_TOKEN`). */
    apiToken: string;
    admin: FixtureUser;
    normal: FixtureUser;
    persons: { active: number; archived: number; deleted: number };
}

const FIXTURES = ['admin_users.json', 'normal_users.json', 'person_status.json'] as const;

export class ContractSetupError extends Error {
    constructor(missing: string[]) {
        super(
            `The contract tests need a ChurchTools test instance and local configuration. Missing: ${missing.join('; ')}. ` +
                'See extension/docs/development.md, section "Contract tests".',
        );
        this.name = 'ContractSetupError';
    }
}

const fixturesDir = () => process.env.CT_FIXTURES_DIR || path.join(BACKEND_DIR, 'tests/Contract/fixtures');

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function firstUser(file: string, missing: string[]): FixtureUser | null {
    try {
        const list = readJson(file) as unknown[];
        const u = (Array.isArray(list) ? list[0] : null) as Partial<FixtureUser> | null;
        if (u && Number.isSafeInteger(Number(u.id)) && typeof u.username === 'string' && typeof u.pwd === 'string') {
            return { id: Number(u.id), username: u.username, pwd: u.pwd };
        }
    } catch {
        // reported below
    }
    missing.push(`a first user with id, username and pwd in ${file}`);
    return null;
}

/** Every missing variable, file and tool, in one list (empty when everything is there). */
export function missingPrerequisites(env: NodeJS.ProcessEnv = process.env): string[] {
    const missing: string[] = [];
    for (const name of ['CT_API_URL', 'CT_API_TOKEN']) {
        if (!env[name]) missing.push(`environment variable ${name} (the value from backend/phpunit.xml)`);
    }
    if (env.CT_API_URL) {
        try {
            const u = new URL(env.CT_API_URL);
            if (u.protocol !== 'https:' || u.username || u.password || !/\/api\/?$/.test(u.pathname)) throw new Error();
        } catch {
            missing.push('CT_API_URL as https://<instance>/api');
        }
    }
    for (const f of FIXTURES) {
        const file = path.join(fixturesDir(), f);
        if (!fs.existsSync(file)) missing.push(`fixture ${file}`);
    }
    if (!fs.existsSync(path.join(BACKEND_DIR, 'vendor/autoload.php'))) missing.push('backend/vendor (run composer install in backend/)');
    if (spawnSync('php', ['-v'], { stdio: 'ignore' }).status !== 0) missing.push('the php command (PHP 8.3 CLI) for the backend sandbox');
    return missing;
}

let cached: ContractEnv | null = null;

/** The configuration, or a `ContractSetupError` naming everything that is missing. */
export function contractEnv(): ContractEnv {
    if (cached) return cached;
    const missing = missingPrerequisites();
    if (missing.length > 0) throw new ContractSetupError(missing);
    const dir = fixturesDir();
    const admin = firstUser(path.join(dir, 'admin_users.json'), missing);
    const normal = firstUser(path.join(dir, 'normal_users.json'), missing);
    const status = readJson(path.join(dir, 'person_status.json')) as Record<string, unknown>;
    const persons = { active: Number(status.active), archived: Number(status.archived), deleted: Number(status.deleted) };
    if (!Object.values(persons).every((id) => Number.isSafeInteger(id) && id > 0)) missing.push('active, archived and deleted ids in person_status.json');
    if (missing.length > 0 || !admin || !normal) throw new ContractSetupError(missing);
    const apiUrl = process.env.CT_API_URL!.replace(/\/+$/, '');
    const url = new URL(apiUrl);
    cached = { apiUrl, root: url.origin, host: url.host, apiToken: process.env.CT_API_TOKEN!, admin, normal, persons };
    return cached;
}

/** Vitest global setup: the run aborts before any test file when something is missing. */
export default function setup(): void {
    contractEnv();
}
