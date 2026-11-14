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
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

/**
 * Builds the app with its config; `NODE_ENV` decides `import.meta.env.DEV` (Vitest itself sets it to `test`).
 * Changing `process.env` is safe only because each test file runs in its own process (Vitest's default `forks` pool,
 * not changed in vitest.config.ts) and these tests run one after another; with `threads` or `isolate: false` it would
 * leak into other files. `afterEach` restores it.
 */
async function buildApp(mode: string, env: 'production' | 'development'): Promise<string[]> {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-build-'));
    dirs.push(outDir);
    process.env.NODE_ENV = env;
    await build({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), mode, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    return checkDist(outDir, { demoStrings: DEMO_STRINGS });
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
});
