import { describe, expect, it } from 'vitest';
import { pickLanguage } from './language';

describe('pickLanguage', () => {
    it('takes the first supported primary subtag', () => {
        expect(pickLanguage(['de-AT', 'en'])).toBe('de');
        expect(pickLanguage(['fr-FR', 'en-GB'])).toBe('en');
        expect(pickLanguage(['fr-FR', 'de'])).toBe('de');
    });
    it('falls back to English', () => {
        expect(pickLanguage(['fr'])).toBe('en');
        expect(pickLanguage([])).toBe('en');
    });
});
