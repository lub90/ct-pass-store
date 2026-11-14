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

/** Where the files and tools live; a parameter so the checks can be unit-tested. */
export interface SetupDeps {
    fixturesDir: string;
    backendDir: string;
    phpAvailable: () => boolean;
}

export const defaultDeps = (env: NodeJS.ProcessEnv = process.env): SetupDeps => ({
    fixturesDir: env.CT_FIXTURES_DIR || path.join(BACKEND_DIR, 'tests/Contract/fixtures'),
    backendDir: BACKEND_DIR,
    phpAvailable: () => spawnSync('php', ['-v'], { stdio: 'ignore' }).status === 0,
});

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** The first user of a fixture file, or `null` (no file, not a list, no integer id, username or pwd). */
function firstUser(file: string): FixtureUser | null {
    try {
        const list = readJson(file);
        const u = (Array.isArray(list) ? list[0] : null) as Record<string, unknown> | null;
        if (u && positiveId(u.id) && typeof u.username === 'string' && u.username !== '' && typeof u.pwd === 'string' && u.pwd !== '') {
            return { id: u.id, username: u.username, pwd: u.pwd };
        }
    } catch {
        // reported by the caller
    }
    return null;
}

function personIds(file: string): ContractEnv['persons'] | null {
    try {
        const s = readJson(file) as Record<string, unknown>;
        if (positiveId(s.active) && positiveId(s.archived) && positiveId(s.deleted)) return { active: s.active, archived: s.archived, deleted: s.deleted };
    } catch {
        // reported by the caller
    }
    return null;
}

const apiUrlOk = (raw: string): boolean => {
    try {
        const u = new URL(raw);
        return u.protocol === 'https:' && u.username === '' && u.password === '' && /^\/api\/?$/.test(u.pathname) && u.search === '' && u.hash === '';
    } catch {
        return false;
    }
};

/**
 * Every missing variable, file, fixture content and tool, in one list (empty when everything is there). The entries
 * name what is missing, never a value.
 */
export function missingPrerequisites(env: NodeJS.ProcessEnv = process.env, deps: SetupDeps = defaultDeps(env)): string[] {
    const missing: string[] = [];
    for (const name of ['CT_API_URL', 'CT_API_TOKEN']) {
        if (!env[name]) missing.push(`environment variable ${name} (the value from backend/phpunit.xml)`);
    }
    if (env.CT_API_URL && !apiUrlOk(env.CT_API_URL)) missing.push('CT_API_URL as https://<instance>/api');
    for (const f of FIXTURES) {
        const file = path.join(deps.fixturesDir, f);
        if (!fs.existsSync(file)) missing.push(`fixture ${file}`);
        else if (f === 'person_status.json' ? personIds(file) === null : firstUser(file) === null) {
            missing.push(f === 'person_status.json' ? `positive integer active, archived and deleted ids in ${file}` : `a first user with integer id, username and pwd in ${file}`);
        }
    }
    if (!fs.existsSync(path.join(deps.backendDir, 'vendor/autoload.php'))) missing.push('backend/vendor (run composer install in backend/)');
    if (!deps.phpAvailable()) missing.push('the php command (PHP 8.3 CLI) for the backend sandbox');
    return missing;
}

/** The configuration, or one `ContractSetupError` naming everything that is missing. */
export function loadContractEnv(env: NodeJS.ProcessEnv = process.env, deps: SetupDeps = defaultDeps(env)): ContractEnv {
    const missing = missingPrerequisites(env, deps);
    if (missing.length > 0) throw new ContractSetupError(missing);
    const apiUrl = env.CT_API_URL!.replace(/\/+$/, '');
    const url = new URL(apiUrl);
    return {
        apiUrl,
        root: url.origin,
        host: url.host,
        apiToken: env.CT_API_TOKEN!,
        admin: firstUser(path.join(deps.fixturesDir, 'admin_users.json'))!,
        normal: firstUser(path.join(deps.fixturesDir, 'normal_users.json'))!,
        persons: personIds(path.join(deps.fixturesDir, 'person_status.json'))!,
    };
}

let cached: ContractEnv | null = null;

/** The configuration of this run (`process.env`), read once. */
export function contractEnv(): ContractEnv {
    return (cached ??= loadContractEnv());
}

/** Vitest global setup: the run aborts before any test file when something is missing. */
export default function setup(): void {
    contractEnv();
}
