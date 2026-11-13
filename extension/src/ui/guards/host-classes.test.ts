/**
 * The extension runs inside the ChurchTools page, whose stylesheet is Tailwind: a class of ours that shares a name
 * with one of its utilities gets that utility, too, wherever our own rule does not set the same property. This test
 * keeps such names out of every component and out of theme.css. (Pattern from infoscreen's host-classes.test.ts.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Utilities of the host that change how an element shows, plus Tailwind's other names of that kind. */
const HOST_UTILITIES = [
    'collapse',
    'visible',
    'invisible',
    'hidden',
    'sr-only',
    'contents',
    'flex',
    'grid',
    'table',
    'fixed',
    'absolute',
    'relative',
    'sticky',
    'container',
    'truncate',
    'border',
    'rounded',
    'shadow',
    'outline',
    'ring',
    'italic',
    'underline',
    'uppercase',
    'lowercase',
    'capitalize',
    'grow',
    'shrink',
    'isolate',
    'transform',
    'filter',
    'blur',
    // A form component of the host: `.cts .select { position: relative }`.
    'select',
    // Harmless in most cases, but a bare name of ours would still meet them.
    'block',
    'inline',
    'static',
];

const SRC = path.resolve('src');

function files(dir: string, ext: string[]): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return files(full, ext);
        return ext.some((e) => entry.name.endsWith(e)) ? [full] : [];
    });
}

/** Class names from `class="…"`, `:class` objects and strings, and the selectors of CSS (`<style>` blocks or .css files). */
function classNames(source: string, isCss: boolean): Set<string> {
    const names = new Set<string>();
    const css: string[] = isCss ? [source] : [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
    if (!isCss) {
        for (const [, list] of source.matchAll(/\sclass="([^"]+)"/g)) list!.split(/\s+/).forEach((n) => names.add(n));
        for (const [, binding] of source.matchAll(/:class="([^"]+)"/g)) {
            for (const [, quoted, key] of binding!.matchAll(/'([\w-]+)'|\b([\w-]+)\s*:/g)) names.add((quoted ?? key)!);
        }
    }
    for (const block of css) {
        const selectors = block
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\{[^{}]*\}/g, '{}')
            .replace(/\{[^{}]*\}/g, '{}');
        for (const [, name] of selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(name!);
    }
    return names;
}

describe('class names next to the host stylesheet', () => {
    const sources = files(SRC, ['.vue', '.css']);

    it('finds the components and the theme', () => {
        expect(sources.some((f) => f.endsWith('theme.css'))).toBe(true);
        expect(sources.filter((f) => f.endsWith('.vue')).length).toBeGreaterThanOrEqual(5);
    });

    it('no component or stylesheet uses a class that ChurchTools styles as a utility', () => {
        const clashes = sources.flatMap((file) =>
            [...classNames(fs.readFileSync(file, 'utf8'), file.endsWith('.css'))]
                .filter((name) => HOST_UTILITIES.includes(name))
                .map((name) => `${path.relative(SRC, file)}: .${name}`),
        );
        expect(clashes).toEqual([]);
    });

    it('the detector sees a clash (self-check)', () => {
        expect([...classNames('<template><p class="flex cps-x" :class="{ hidden: a }" /></template>', false)]).toEqual(
            expect.arrayContaining(['flex', 'hidden']),
        );
        expect([...classNames('.cps :where(.collapse) { a: b }', true)]).toContain('collapse');
    });
});
