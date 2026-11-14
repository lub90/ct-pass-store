/**
 * The password policy, mirrored from the backend (backend spec 5.1, `PasswordPolicy::violations()`). The backend
 * decides; this only gives the person feedback before sending. Both run the same cases
 * (`shared/password-policy-cases.json`), so they cannot drift.
 */
export type Rule = 'too-short' | 'too-long' | 'missing-letter' | 'missing-digit' | 'missing-symbol' | 'invalid-character';

export const SYMBOLS = '!@$%&*-_+=?.';
export const MAX_LENGTH = 128;

const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isDigit = (c: string) => c >= '0' && c <= '9';
const isSymbol = (c: string) => c.length === 1 && SYMBOLS.includes(c);

/**
 * The rules the password breaks, in the backend's order; empty if it's valid. Nothing is trimmed or normalized: a
 * trailing space or newline is an `invalid-character`. The length counts UTF-8 bytes like the backend (`strlen`), and
 * a password over the maximum reports only `too-long`.
 */
export function checkPassword(pw: string, minLength: number): Rule[] {
    const bytes = new TextEncoder().encode(pw).length;
    if (bytes > MAX_LENGTH) return ['too-long'];

    const rules: Rule[] = [];
    if (bytes < minLength) rules.push('too-short');
    // Iterate UTF-16 code units: any non-ASCII unit fails all three tests and ends up as invalid-character.
    const chars = pw.split('');
    if (!chars.some(isLetter)) rules.push('missing-letter');
    if (!chars.some(isDigit)) rules.push('missing-digit');
    if (!chars.some(isSymbol)) rules.push('missing-symbol');
    if (!chars.every((c) => isLetter(c) || isDigit(c) || isSymbol(c))) rules.push('invalid-character');
    return rules;
}
