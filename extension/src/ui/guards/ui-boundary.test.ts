/**
 * `ui/` is a closed library that later moves to a shared package: it may import only from inside `src/ui/`,
 * `vue` and `@mdi/js`. Labels come in as props; there is no i18n, router or app code in here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = path.resolve('src/ui');
const ALLOWED_PACKAGES = ['vue', '@mdi/js'];

function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return files(full);
        return /\.(vue|ts|css)$/.test(entry.name) ? [full] : [];
    });
}

/** Import specifiers: `import … from 'x'`, `import 'x'`, `import('x')`, `export … from 'x'`, CSS `@import`. */
export function specifiers(source: string): string[] {
    const found: string[] = [];
    const patterns = [
        /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
        /\bimport\s*['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g,
    ];
    for (const re of patterns) for (const m of source.matchAll(re)) found.push(m[1]!);
    return found;
}

function violation(file: string, spec: string): boolean {
    if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        return target !== UI && !target.startsWith(UI + path.sep);
    }
    return !ALLOWED_PACKAGES.some((p) => spec === p || spec.startsWith(p + '/'));
}

describe('ui/ is a closed library', () => {
    const sources = files(UI).filter((f) => !f.endsWith('.test.ts'));

    it('finds its files', () => {
        expect(sources.length).toBeGreaterThan(5);
    });

    it('imports only from src/ui, vue and @mdi/js', () => {
        const bad = sources.flatMap((file) =>
            specifiers(fs.readFileSync(file, 'utf8'))
                .filter((spec) => violation(file, spec))
                .map((spec) => `${path.relative(UI, file)} imports ${spec}`),
        );
        expect(bad).toEqual([]);
    });

    it('the detector sees a violation (self-check)', () => {
        const file = path.join(UI, 'x.ts');
        const bad = specifiers(`import { a } from '../stores/a';\nimport b from '@/x';\nimport { ref } from 'vue';\nimport 'pinia';`);
        expect(bad.filter((s) => violation(file, s))).toEqual(['../stores/a', '@/x', 'pinia']);
    });
});
