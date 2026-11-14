import { describe, expect, it } from 'vitest';
import { sameMajorMinor } from './version';

describe('sameMajorMinor (versioning.md section 3)', () => {
    it.each([
        ['0.1.3', '0.1.0+abc-dirty'],
        ['0.1.0', '0.1.0'],
        ['0.1.0+abc', '0.1.9+def'],
        ['1.2.3+unknown', '1.2.0'],
        ['10.20.0', '10.20.5'],
    ])('treats %s and %s as the same MAJOR.MINOR', (a, b) => {
        expect(sameMajorMinor(a, b)).toBe(true);
        expect(sameMajorMinor(b, a)).toBe(true);
    });

    it.each([
        ['0.2.0', '0.1.9'],
        ['1.1.0', '0.1.0'],
        ['0.1.0', '0.10.0'],
        ['0.1.0', '1.0.0'],
        ['1.10.0', '11.0.0'],
    ])('treats %s and %s as different', (a, b) => {
        expect(sameMajorMinor(a, b)).toBe(false);
        expect(sameMajorMinor(b, a)).toBe(false);
    });

    it.each([
        ['', '0.1.0'],
        ['0.1', '0.1.0'],
        ['x.y.z', 'x.y.z'],
        ['0.1.0', 'v0.1.0'],
        ['0.1.0', ' 0.1.0'],
        ['0.1.0-beta', '0.1.0'],
        ['0.1.0.4', '0.1.0'],
        ['test', 'test'],
    ])('never matches a malformed version (%j, %j)', (a, b) => {
        expect(sameMajorMinor(a, b)).toBe(false);
    });
});
