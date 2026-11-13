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

/**
 * Violations in a stylesheet text: a `transition`/`transition-duration` part without the token, or any `animation*`.
 * There is no animation token yet: add one, with its reduced-motion rule in theme.css, before the first animation.
 */
export function motionViolations(css: string): string[] {
    const bad: string[] = [];
    for (const [, prop, value] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{\s])((?:transition|animation)(?:-[\w-]+)?)\s*:\s*([^;}]+)/g)) {
        if (prop!.startsWith('animation')) {
            bad.push(`${prop}: ${value!.trim()} (no animation token yet: add one and its reduced-motion rule first)`);
        } else if (prop === 'transition' || prop === 'transition-duration') {
            // Every comma-separated part has to read the token.
            const parts = value!.split(/,(?![^(]*\))/);
            if (parts.some((part) => !part.includes('var(--cps-transition)'))) bad.push(`${prop}: ${value!.trim()}`);
        }
    }
    return bad;
}

function styleBlocks(source: string): string {
    return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

describe('motion goes through the token', () => {
    it('no component and not theme.css writes a raw transition or an animation', () => {
        const files = vueFiles(SRC);
        expect(files.length).toBeGreaterThan(0);
        const bad = files.flatMap((f) => motionViolations(styleBlocks(fs.readFileSync(f, 'utf8'))).map((v) => `${path.relative(SRC, f)}: ${v}`));
        const theme = motionViolations(fs.readFileSync(path.join(SRC, 'ui/theme.css'), 'utf8')).map((v) => `ui/theme.css: ${v}`);
        expect([...bad, ...theme]).toEqual([]);
    });

    it('theme.css really has transitions to check', () => {
        expect(fs.readFileSync(path.join(SRC, 'ui/theme.css'), 'utf8')).toContain('var(--cps-transition)');
    });

    it('the detector fires (self-check)', () => {
        expect(motionViolations('.a { transition: color 150ms ease; }')).toHaveLength(1);
        expect(motionViolations('.a { transition: color var(--cps-transition), border-color 1s; }')).toHaveLength(1);
        expect(motionViolations('.a { transition-duration: 0.3s }')).toHaveLength(1);
        expect(motionViolations('.a { animation: spin 1s; animation-duration: 2s }')).toHaveLength(2);
        expect(motionViolations('.a { animation: spin var(--cps-animation) }')).toHaveLength(1);
        expect(motionViolations('.a { transition: color var(--cps-transition), border-color var(--cps-transition); }')).toEqual([]);
        // The two sources the guard scans: a .vue style block and a theme.css text.
        expect(motionViolations(styleBlocks('<style scoped>.a { transition: all 1s }</style>'))).toHaveLength(1);
        expect(motionViolations('.cps :where(a) {\n    transition:\n        color 1s,\n        border 1s;\n}')).toHaveLength(1);
    });

    it('theme.css zeroes the token under reduced motion and uses no !important', () => {
        const css = fs.readFileSync(path.join(SRC, 'ui/theme.css'), 'utf8');
        expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.cps\s*\{\s*--cps-transition:\s*0s/);
        expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('!important');
    });
});
