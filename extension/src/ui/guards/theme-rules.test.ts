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
