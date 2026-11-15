import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve('src/ui/theme.css'), 'utf8');

describe('theme.css button rules', () => {
    it.each(['primary', 'create', 'danger', 'ghost'])('%s has its own hover rule', (variant) => {
        expect(css).toContain(`button.cps-btn--${variant}:hover:not(:disabled)`);
    });

    it('the create background is darkened for white text', () => {
        expect(css).toMatch(/--cps-create:\s*color-mix\(in oklab, var\(--color-constructive-b-bright[^;]*72%, black\)/);
        expect(css).toMatch(/--cps-create-text:\s*var\(--color-constructive-inverted, #fff\)/);
    });
});

describe('theme.css form action rows', () => {
    // Spec 9.3: on a phone the buttons stretch to the full width; `flex: 1 1 100%` needs a flex row around them (found
    // by the browser tests: without it the buttons kept their own width). `e2e/layout.spec.ts` measures it.
    it('the action row is a wrapping flex row', () => {
        const rule = /\.cps :where\(\.cps-form-actions\)\s*{([^}]*)}/.exec(css)?.[1] ?? '';
        expect(rule).toMatch(/display:\s*flex/);
        expect(rule).toMatch(/flex-wrap:\s*wrap/);
    });
});

describe('theme.css standalone links', () => {
    // Spec 1.3: 44 px touch targets also for links that stand alone (back links, „Über“); links in running text are
    // exempt (WCAG 2.5.8 inline exception). `e2e/layout.spec.ts` measures them; the browser tests found 16 px ones.
    it('a .cps-link is at least 44 px high on a coarse pointer', () => {
        const coarse = [...css.matchAll(/@media \(pointer: coarse\) {([\s\S]*?)\n}/g)].map((m) => m[1]).join('\n');
        const rule = /\.cps :where\(a\.cps-link\)\s*{([^}]*)}/.exec(coarse)?.[1] ?? '';
        expect(rule).toMatch(/min-height:\s*44px/);
        expect(rule).toMatch(/display:\s*inline-flex/);
        expect(rule).toMatch(/align-items:\s*center/);
    });
});
