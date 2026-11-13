/**
 * Reduced motion (spec 9.4) works without `!important`: theme.css sets `--cps-transition` to 0s under
 * `prefers-reduced-motion: reduce`. That only helps if every transition and animation reads the token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve('src');

function vueFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return vueFiles(full);
        return entry.name.endsWith('.vue') ? [full] : [];
    });
}

/** Declarations of transition/animation properties in the `<style>` blocks whose value lacks the token. */
export function motionViolations(source: string): string[] {
    const bad: string[] = [];
    for (const [, block] of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        const css = block!.replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:transition|animation)(?:-[\w-]+)?)\s*:\s*([^;}]+)/g)) {
            if (!/var\(--cps-(?:transition|animation)\)/.test(value!)) bad.push(`${prop}: ${value!.trim()}`);
        }
    }
    return bad;
}

describe('motion goes through the token', () => {
    it('no component writes a raw transition or animation', () => {
        const files = vueFiles(SRC);
        expect(files.length).toBeGreaterThan(0);
        const bad = files.flatMap((f) => motionViolations(fs.readFileSync(f, 'utf8')).map((v) => `${path.relative(SRC, f)}: ${v}`));
        expect(bad).toEqual([]);
    });

    it('the detector fires (self-check)', () => {
        expect(motionViolations('<style>.a { transition: color 150ms ease; }</style>')).toHaveLength(1);
        expect(motionViolations('<style scoped>.a { animation: spin 1s; transition-duration: 0.3s }</style>')).toHaveLength(2);
        expect(motionViolations('<style>.a { transition: color var(--cps-transition); }</style>')).toEqual([]);
    });

    it('theme.css zeroes the token under reduced motion and uses no !important', () => {
        const css = fs.readFileSync(path.join(SRC, 'ui/theme.css'), 'utf8');
        expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.cps\s*\{\s*--cps-transition:\s*0s/);
        expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('!important');
    });
});
