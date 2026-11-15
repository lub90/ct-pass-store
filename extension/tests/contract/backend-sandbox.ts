import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { BACKEND_DIR, type ContractEnv } from './setup';

/**
 * The address the extension's backend client is given. The client accepts `https://` only (no localhost escape hatch
 * in `src/`), so the tests give it this https address and `sandboxFetch` maps it to the plain-HTTP sandbox. The
 * `.invalid` domain can never resolve, so nothing can leak to a real host if the mapping is missing.
 */
export const SANDBOX_BASE = 'https://backend.contract.invalid';

const DIR_PREFIX = 'cps-backend-sandbox-';

/** The folders of the sandboxes this process runs; the sweep for crashed runs leaves them alone. */
const liveDirs = new Set<string>();

/** The settings a sandbox's backend sees instead of the instance's (`sandbox/SandboxChurchTools.php`). */
export interface SettingsVariant {
    requirePasswordForPasswordChange: boolean;
    allowCustomPassword: boolean;
}

export interface SandboxOptions {
    oauthClientId: string;
    oauthClientSecret: string;
    /** The https address the client is given for this sandbox (several sandboxes run side by side). */
    base?: string;
    /** Replaces these settings in what the backend reads; the instance's settings value stays as it is. */
    settings?: { variant: SettingsVariant; categoryId: number };
    /** The backend sees an `access` value naming this group as the admin group (the instance has none). */
    adminGroupId?: number;
}

/** A request the extension sent to the sandbox, as seen on the wire (for the CORS checks). */
export interface SeenRequest {
    method: string;
    headerNames: string[];
}

/**
 * The real backend (this repository's `backend/`) on PHP's built-in server, like the backend's own
 * `BackendSandboxManager`: 127.0.0.1, a free port, several workers, a fresh cache and log folder per run. Its
 * configuration comes from the environment only (`sandbox/credentials.php` holds no values); the JWT secret is
 * random per run and known to the test, so it can produce an expired token.
 */
export class BackendSandbox {
    readonly jwtSecret = randomBytes(32).toString('hex');
    readonly seen: SeenRequest[] = [];
    readonly base: string;
    private process: ChildProcess | null = null;
    private dir: string | null = null;
    private port = 0;
    private onExit: (() => void) | null = null;
    private onSignal: ((signal: NodeJS.Signals) => void) | null = null;

    private readonly env: ContractEnv;
    private readonly options: SandboxOptions;

    constructor(env: ContractEnv, options: SandboxOptions) {
        this.env = env;
        this.options = options;
        this.base = options.base ?? SANDBOX_BASE;
    }

    get httpBase(): string {
        return `http://127.0.0.1:${this.port}`;
    }

    async start(): Promise<void> {
        this.port = await freePort();
        // Folders of a crashed run (one contract run per instance at a time, so none of them is in use).
        sweepStaleDirs(os.tmpdir(), DIR_PREFIX, process.getuid?.() ?? -1, liveDirs);
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), DIR_PREFIX));
        liveDirs.add(this.dir);
        fs.mkdirSync(path.join(this.dir, 'cache'), { mode: 0o700 });
        fs.mkdirSync(path.join(this.dir, 'logs'), { mode: 0o700 });
        const childEnv: NodeJS.ProcessEnv = {
            PATH: process.env.PATH,
            PHP_CLI_SERVER_WORKERS: '4',
            CPS_SANDBOX_BACKEND_DIR: BACKEND_DIR,
            CPS_SANDBOX_CACHE_DIR: path.join(this.dir, 'cache'),
            CPS_SANDBOX_CT_API_URL: this.env.apiUrl,
            CPS_SANDBOX_CT_API_TOKEN: this.env.apiToken,
            CPS_SANDBOX_CORS_ORIGIN: this.env.root,
            CPS_SANDBOX_OAUTH_CLIENT_ID: this.options.oauthClientId,
            CPS_SANDBOX_OAUTH_CLIENT_SECRET: this.options.oauthClientSecret,
            CPS_SANDBOX_JWT_SECRET: this.jwtSecret,
            ...sandboxOverrideEnv(this.options),
        };
        // Output is discarded: the built-in server logs request lines, which must not end up in the test output.
        this.process = spawn('php', ['-S', `127.0.0.1:${this.port}`, path.join(import.meta.dirname, 'sandbox/router.php')], {
            env: childEnv,
            cwd: path.join(BACKEND_DIR, 'public'),
            stdio: 'ignore',
        });
        // If the test process ends without afterAll (Ctrl-C, a crash), the server must not keep running with the token.
        const child = this.process;
        this.onExit = () => {
            if (child.exitCode === null) child.kill('SIGKILL');
        };
        this.onSignal = (signal: NodeJS.Signals) => {
            this.onExit?.();
            this.removeExitHooks();
            process.kill(process.pid, signal);
        };
        process.once('exit', this.onExit);
        process.once('SIGINT', this.onSignal);
        process.once('SIGTERM', this.onSignal);
        // An unknown route answers 404 once the app is up; a misconfigured backend answers 500 to everything.
        let last = 'no answer';
        for (let i = 0; i < 50; i++) {
            try {
                const r = await fetch(`${this.httpBase}/v1/no-such-route`);
                if (r.status === 404) return;
                last = `HTTP ${r.status}`;
            } catch {
                // not up yet
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`The backend sandbox did not start within 5 s (${last}).`);
    }

    private removeExitHooks(): void {
        if (this.onExit) process.removeListener('exit', this.onExit);
        if (this.onSignal) {
            process.removeListener('SIGINT', this.onSignal);
            process.removeListener('SIGTERM', this.onSignal);
        }
        this.onExit = null;
        this.onSignal = null;
    }

    async stop(): Promise<void> {
        this.removeExitHooks();
        const child = this.process;
        this.process = null;
        if (child && child.exitCode === null) {
            const exited = new Promise((r) => child.once('exit', r));
            child.kill('SIGTERM');
            await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
            if (child.exitCode === null) child.kill('SIGKILL');
        }
        // The cache and logs hold person ids and signed records of this run only.
        if (this.dir) {
            fs.rmSync(this.dir, { recursive: true, force: true });
            liveDirs.delete(this.dir);
        }
        this.dir = null;
    }

    /**
     * A `fetch` for `vi.stubGlobal`: requests to this sandbox's `base` go to the sandbox (recording method and header
     * names), everything else to `realFetch` (the real `fetch`, or another sandbox's `fetchFor`).
     */
    fetchFor(realFetch: typeof fetch): typeof fetch {
        return async (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (!url.startsWith(`${this.base}/`)) return realFetch(input, init);
            const headers = new Headers(init?.headers);
            this.seen.push({ method: init?.method ?? 'GET', headerNames: [...headers.keys()] });
            return realFetch(`${this.httpBase}${url.slice(this.base.length)}`, init);
        };
    }

    /** A token as `POST /v1/auth/token` issues it (backend `UserTokens`), with the claims and lifetime given. */
    mintToken(personId: number, username: string, admin: boolean, issuedSecondsAgo = 0, lifetime = 900): string {
        const now = Math.floor(Date.now() / 1000) - issuedSecondsAgo;
        const claims = { iss: 'ctpassstore-backend', aud: 'ctpassstore-api', sub: String(personId), username, admin, iat: now, nbf: now, exp: now + lifetime, jti: randomBytes(16).toString('hex') };
        const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const unsigned = `${part({ typ: 'JWT', alg: 'HS256' })}.${part(claims)}`;
        return `${unsigned}.${createHmac('sha256', this.jwtSecret).update(unsigned).digest('base64url')}`;
    }
}

/** The environment of `sandbox/SandboxChurchTools.php` for the options (nothing when there is no override). */
export function sandboxOverrideEnv(options: Pick<SandboxOptions, 'settings' | 'adminGroupId'>): Record<string, string> {
    const env: Record<string, string> = {};
    if (options.settings) {
        const { requirePasswordForPasswordChange, allowCustomPassword } = options.settings.variant;
        env.CPS_SANDBOX_SETTINGS = JSON.stringify({ requirePasswordForPasswordChange, allowCustomPassword });
        env.CPS_SANDBOX_SETTINGS_CATEGORY_ID = String(options.settings.categoryId);
    }
    if (options.adminGroupId !== undefined) env.CPS_SANDBOX_ADMIN_GROUP_ID = String(options.adminGroupId);
    return env;
}

/**
 * Deletes the folders in `dir` whose name starts with `prefix` and that belong to `uid` (another user's folders are
 * none of this run's business), except those in `keep` (sandboxes of this run). A folder that can't be deleted is
 * skipped; the sweep goes on.
 */
export function sweepStaleDirs(dir: string, prefix: string, uid: number, keep: ReadonlySet<string> = new Set()): void {
    for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(prefix)) continue;
        const full = path.join(dir, name);
        if (keep.has(full)) continue;
        try {
            const stat = fs.lstatSync(full);
            if (!stat.isDirectory() || stat.uid !== uid) continue;
            fs.rmSync(full, { recursive: true, force: true });
        } catch {
            // left for the next run or for a person; never a reason to stop
        }
    }
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });
}
