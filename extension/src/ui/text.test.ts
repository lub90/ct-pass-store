import { describe, expect, it } from 'vitest';
import { isolate } from './text';

describe('isolate', () => {
    it('wraps a text in first-strong isolate and pop isolate (the text form of <bdi>)', () => {
        expect(isolate('Eva Beck')).toBe('\u2068Eva Beck\u2069');
    });

    it('neutralises bidi controls inside the text (U+FFFD), so it can’t close the isolate early or override what follows', () => {
        expect(isolate('Eve\u2069\u202Eevil')).toBe('\u2068Eve\uFFFD\uFFFDevil\u2069');
        const controls = ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069'];
        expect(isolate(controls.join(''))).toBe(`\u2068${'\uFFFD'.repeat(9)}\u2069`);
    });

    it('keeps everything else, also the neighbours of those ranges and the marks U+200E/U+200F', () => {
        const kept = 'Jürgen \u2029\u2065\u206A\u200E\u200F <b>{x}</b>';
        expect(isolate(kept)).toBe(`\u2068${kept}\u2069`);
    });
});
