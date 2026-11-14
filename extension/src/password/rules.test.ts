import { describe, expect, it } from 'vitest';
import cases from '../../../shared/password-policy-cases.json';
import { checkPassword, SYMBOLS, type Rule } from './rules';

interface Case {
    name: string;
    password: string;
    minLength: number;
    violations: Rule[];
}

describe('checkPassword (shared cases, same list as the backend)', () => {
    it('has a meaningful number of cases', () => {
        expect(cases.length).toBeGreaterThan(100);
    });

    for (const c of cases as Case[]) {
        it(c.name, () => {
            expect(checkPassword(c.password, c.minLength)).toEqual(c.violations);
        });
    }
});

describe('checkPassword', () => {
    it('uses the backend symbol set', () => {
        expect(SYMBOLS).toBe('!@$%&*-_+=?.');
    });

    it('flags a trailing space as invalid-character and never trims it', () => {
        expect(checkPassword('Abcdefgh12!? ', 12)).toEqual(['invalid-character']);
        expect(checkPassword('Abcdefgh12!?\n', 12)).toEqual(['invalid-character']);
        expect(checkPassword('Abcdefgh12!?', 12)).toEqual([]);
    });

    it('counts UTF-8 bytes for the length, like the backend', () => {
        expect(checkPassword(`Aa1!${'x'.repeat(123)}ä`, 12)).toEqual(['too-long']);
        expect(checkPassword(`Aa1!${'x'.repeat(122)}ä`, 12)).toEqual(['invalid-character']);
    });

    it('reports every allowed character as valid', () => {
        const all = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@$%&*-_+=?.';
        for (const ch of all) expect(checkPassword(`Aa1!bbbbbbbb${ch}`, 12), ch).toEqual([]);
    });

    it('rejects every other ASCII code point', () => {
        const allowed = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@$%&*-_+=?.';
        for (let code = 0; code < 128; code++) {
            const ch = String.fromCharCode(code);
            if (allowed.includes(ch)) continue;
            expect(checkPassword(`Aa1!bbbbbbbb${ch}`, 12), `code ${code}`).toContain('invalid-character');
        }
    });

    it('does not treat a lone surrogate as valid', () => {
        expect(checkPassword('Aa1!bbbbbbbb\ud800', 12)).toContain('invalid-character');
    });
});

describe('the shared cases', () => {
    it('cover all 128 ASCII code points', () => {
        const seen = new Set<number>();
        for (const c of cases as Case[]) for (const ch of c.password) if (ch.codePointAt(0)! < 128) seen.add(ch.codePointAt(0)!);
        const missing = Array.from({ length: 128 }, (_, i) => i).filter((i) => !seen.has(i));
        expect(missing).toEqual([]);
    });
});

describe('the fake backend', () => {
    it('answers every shared case with the same violations (one source)', async () => {
        const { createFakeBackend } = await import('@/dev/fake-backend');
        for (const c of cases as Case[]) {
            if (c.minLength < 12 || c.minLength > 64) continue;
            const fake = createFakeBackend({ passwordLength: c.minLength, requirePasswordForPasswordChange: false });
            const result = fake.putEntry(1, { secondaryPwd: c.password });
            if (c.violations.length === 0) {
                await expect(result, c.name).resolves.toEqual({});
            } else {
                await expect(result, c.name).rejects.toMatchObject({ slug: 'password-invalid', violations: c.violations });
            }
        }
    });
});
