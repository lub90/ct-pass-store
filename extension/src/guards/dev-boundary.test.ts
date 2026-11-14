/**
 * The demo stays in development (spec 13.6, security F4 and the Task 8 carry): production code reaches `src/dev/`
 * only through the literal demo condition in `main.ts`, never uses `localStorage`, and never turns on local http for
 * the backend client.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServices } from '@/app/services';
import { BackendConfigError } from '@/backend/problems';

const SRC = path.resolve('src');
const DEV = path.join(SRC, 'dev');
const HARNESS = path.join(SRC, 'views', 'settings', 'settings-harness.ts');

function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return files(full);
        return /\.(ts|vue)$/.test(entry.name) ? [full] : [];
    });
}

/** Modules that can end up in a build: not tests, not `dev/`, not the test harness. */
const production = files(SRC).filter((f) => !f.endsWith('.test.ts') && !f.startsWith(DEV + path.sep) && f !== HARNESS);
const rel = (f: string) => path.relative(SRC, f);
/** `from '…'`, bare `import '…'` and `import('…')`. */
const imports = (f: string) =>
    [...fs.readFileSync(f, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]!);

describe('dev boundary', () => {
    it('finds production modules (self-check)', () => {
        expect(production.map(rel)).toContain('main.ts');
        expect(production.map(rel)).toContain(path.join('backend', 'api.ts'));
    });

    it('only main.ts imports from dev/, and only the demo services', () => {
        const found = production.flatMap((f) => imports(f).filter((i) => /(^|\/)dev\//.test(i)).map((i) => `${rel(f)} -> ${i}`));
        expect(found).toEqual(['main.ts -> ./dev/services']);
    });

    it('main.ts chooses the demo with the literal build condition', () => {
        const main = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8');
        expect(main).toContain("import.meta.env.DEV && import.meta.env.MODE !== 'real' ? startDemo(language) : createServices(language)");
        expect(main.match(/startDemo\(/g)).toHaveLength(1);
    });

    it('the settings test harness is imported by tests only', () => {
        const found = production.filter((f) => imports(f).some((i) => i.includes('settings-harness'))).map(rel);
        expect(found).toEqual([]);
    });

    it('production code never uses localStorage (the demo keeps its state there)', () => {
        const found = production.filter((f) => fs.readFileSync(f, 'utf8').includes('localStorage')).map(rel);
        expect(found).toEqual([]);
    });

    it('only backend/api.ts mentions allowLocalHttp: nothing in the app turns it on', () => {
        const found = production.filter((f) => fs.readFileSync(f, 'utf8').includes('allowLocalHttp')).map(rel);
        expect(found).toEqual([path.join('backend', 'api.ts')]);
    });

    it('the real services refuse a local http backend', () => {
        const services = createServices('de');
        for (const url of ['http://localhost:8080', 'http://127.0.0.1', 'http://localhost']) {
            expect(() => services.backend(url), url).toThrow(BackendConfigError);
        }
        expect(() => services.backend('https://pw.example')).not.toThrow();
    });
});
