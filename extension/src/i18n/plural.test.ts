/** The rate-limit texts have a singular and a plural form; vue-i18n picks it from the named `n` (no plural argument). */
import { describe, expect, it } from 'vitest';
import { createAppI18n } from '.';

const t = (language: 'de' | 'en') => createAppI18n(language).global.t;

describe('plural texts', () => {
    it.each([
        ['de', 'problems.rateLimited', 1, 'Zu viele Versuche. Versuch es in einer Minute noch einmal.'],
        ['de', 'problems.rateLimited', 5, 'Zu viele Versuche. Versuch es in 5 Minuten noch einmal.'],
        ['en', 'problems.rateLimited', 1, 'Too many attempts. Try again in a minute.'],
        ['en', 'problems.rateLimited', 5, 'Too many attempts. Try again in 5 minutes.'],
        ['de', 'state.ctRateLimited', 1, 'ChurchTools bremst gerade. Versuch es in einer Minute noch einmal.'],
        ['en', 'state.ctRateLimited', 2, 'ChurchTools is slowing down requests. Try again in 2 minutes.'],
    ] as const)('%s %s with n=%s', (language, key, n, text) => {
        expect(t(language)(key, { n })).toBe(text);
    });

    it('leaves messages without a plural form alone, also with an {n}', () => {
        expect(t('de')('problems.generic', { status: 500, n: 3 })).toBe('Etwas ist schiefgelaufen (500).');
    });
});
