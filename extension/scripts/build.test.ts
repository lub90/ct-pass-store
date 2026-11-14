// @vitest-environment node
/**
 * The demo branch of `main.ts` (spec 13.6, security F4): the app's own Vite config builds it in only when
 * `import.meta.env.DEV` is true and the mode is not `real`. A production build must pass `check-dist` with the demo
 * data strings; a development build must fail it (proving the markers reach a bundle that contains the demo).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_STRINGS } from '../src/dev/demo-data';
import { checkDist } from './check-dist.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const dirs: string[] = [];
const nodeEnv = process.env.NODE_ENV;

afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
    delete process.env.CPS_ALLOW_NON_PRODUCTION_BUILD;
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

/**
 * Builds the app with its config; `NODE_ENV` decides `import.meta.env.DEV` (Vitest itself sets it to `test`).
 * Changing `process.env` is safe only because each test file runs in its own process (Vitest's default `forks` pool,
 * not changed in vitest.config.ts) and these tests run one after another; with `threads` or `isolate: false` it would
 * leak into other files. `afterEach` restores it.
 */
async function buildApp(mode: string, env: 'production' | 'development'): Promise<string[]> {
    return checkDist(await buildInto(mode, env, { allowNonProduction: true }), { demoStrings: DEMO_STRINGS });
}

/**
 * `allowNonProduction` sets `CPS_ALLOW_NON_PRODUCTION_BUILD=1`, the tests' only way past the production guard of
 * `vite.config.ts` (spec 13.7); `afterEach` removes it again.
 */
async function buildInto(mode: string, env: 'production' | 'development', { allowNonProduction = false } = {}): Promise<string> {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-build-'));
    dirs.push(outDir);
    process.env.NODE_ENV = env;
    if (allowNonProduction) process.env.CPS_ALLOW_NON_PRODUCTION_BUILD = '1';
    await build({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), mode, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    return outDir;
}

/** The one JavaScript bundle of a build. */
function bundleOf(outDir: string): string {
    const assets = path.join(outDir, 'assets');
    const [js] = fs.readdirSync(assets).filter((f) => f.endsWith('.js'));
    return fs.readFileSync(path.join(assets, js!), 'utf8');
}

describe('the demo in builds', () => {
    it('a production build has no demo code and no demo data', async () => {
        expect(await buildApp('production', 'production')).toEqual([]);
    }, 60_000);

    it('a development build contains the demo (so the markers would be found)', async () => {
        const failures = await buildApp('development', 'development');
        expect(failures.some((f) => f.startsWith('demo code (__DEMO__)'))).toBe(true);
        expect(failures.some((f) => f.startsWith('demo data "Platzhalterberg"'))).toBe(true);
    }, 60_000);

    it('real mode never contains the demo, also with DEV on', async () => {
        expect(await buildApp('real', 'development')).toEqual([]);
    }, 60_000);

    it('a production build keeps the backend login (main.ts passes backendLogin: true, minified !0)', async () => {
        const code = bundleOf(await buildInto('production', 'production'));
        expect(code).toMatch(/\{backendLogin:(!0|true)\}/);
        expect(code).not.toMatch(/\{backendLogin:(!1|false)\}/);
    }, 60_000);
});

describe('only production builds (spec 13.7, a release must never ship a development build)', () => {
    it.each([
        ['development', 'development'],
        ['real', 'development'],
        ['real', 'production'],
        ['staging', 'production'],
        ['production', 'development'],
    ] as const)('refuses a build in mode %s with NODE_ENV %s', async (mode, env) => {
        await expect(buildInto(mode, env)).rejects.toThrow(/only production builds/);
    }, 60_000);

    it('refuses a development build even when the guard variable has another value than 1', async () => {
        process.env.CPS_ALLOW_NON_PRODUCTION_BUILD = 'true';
        await expect(buildInto('development', 'development')).rejects.toThrow(/only production builds/);
    }, 60_000);

    it('builds in mode production with NODE_ENV production', async () => {
        expect(bundleOf(await buildInto('production', 'production'))).not.toBe('');
    }, 60_000);
});
