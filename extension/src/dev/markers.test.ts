// @vitest-environment node
/**
 * Security F4: every module under `src/dev/` carries the demo marker in its code (not in a comment), so that
 * `check-dist` notices any of them in a production build. Each module is bundled and minified on its own, with only
 * its main export used, and the marker must survive.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

const DEV = import.meta.dirname;
const SRC = path.resolve(DEV, '..');

/** The main export of each dev module: what a leaked import would pull into a bundle. */
const MAIN_EXPORT: Record<string, string> = {
    'marker.ts': 'tagDemo',
    'demo-data.ts': 'DEMO_SEED',
    'fake-churchtools.ts': 'createFakeChurchTools',
    'fake-backend.ts': 'createFakeBackend',
    'services.ts': 'createDemoServices',
};

/** Bundles `export default <name>` of the module, minified, and returns the code. */
async function bundle(file: string, name: string): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-marker-'));
    try {
        const entry = path.join(dir, 'entry.ts');
        fs.writeFileSync(entry, `import { ${name} } from ${JSON.stringify(path.join(DEV, file))};\nexport default ${name};\n`);
        const result = await build({
            configFile: false,
            logLevel: 'silent',
            define: { __APP_VERSION__: '"test"' },
            resolve: { alias: { '@': SRC } },
            build: {
                write: false,
                minify: true,
                // Not lib mode: an app build, which drops comments, so only code can carry the marker.
                rollupOptions: {
                    input: entry,
                    preserveEntrySignatures: 'exports-only',
                    external: (id) => /^(vue|vue-router|vue-i18n|valibot|@churchtools|@mdi)(\/|$)/.test(id),
                },
            },
        });
        const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
        return outputs
            .flatMap((o) => o.output)
            .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
            .join('\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('demo markers in src/dev', () => {
    /** Every file below src/dev (any depth, any kind) except tests. */
    const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(DEV, path.join(dir, e.name))]));
    const modules = walk(DEV).filter((f) => !/\.test\.[jt]s$/.test(f));

    it('knows every dev module', () => {
        expect(modules.sort()).toEqual(Object.keys(MAIN_EXPORT).sort());
    });

    for (const [file, name] of Object.entries(MAIN_EXPORT)) {
        it(`${file}: the marker survives a minified build of ${name}`, async () => {
            const code = await bundle(file, name);
            expect(code).toContain('__DEMO__');
        }, 30_000);
    }
});
