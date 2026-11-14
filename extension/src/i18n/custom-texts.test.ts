import { describe, expect, it } from 'vitest';
import { isBlankText, pageTexts } from './custom-texts';

describe('pageTexts', () => {
    it('uses the defaults of spec 4.6', () => {
        expect(pageTexts(undefined, 'de')).toEqual({
            title: 'Mein Zweitpasswort',
            intro: 'Ein eigenes Passwort für angebundene Dienste wie das WLAN. Es ist unabhängig von deinem ChurchTools-Passwort.',
        });
        expect(pageTexts({}, 'en')).toEqual({
            title: 'My secondary password',
            intro: "A separate password for connected services such as Wi-Fi. It's independent of your ChurchTools password.",
        });
    });
    it('falls back when a field is empty or blank', () => {
        expect(pageTexts({ de: { title: '  ', intro: '' } }, 'de').title).toBe('Mein Zweitpasswort');
        expect(pageTexts({ de: { title: '  ', intro: '' } }, 'de').intro).toMatch(/^Ein eigenes Passwort/);
    });
    it('falls back when a field holds only invisible characters (format characters and spaces)', () => {
        expect(pageTexts({ de: { title: '\u200B', intro: ' \u200D\u2060 ' } }, 'de')).toEqual(pageTexts({}, 'de'));
    });
    it('isBlankText: whitespace and format characters only', () => {
        for (const blank of ['', ' ', '\t\n', '\u200B', '\u00AD', '\uFEFF', '\u202E']) expect(isBlankText(blank), JSON.stringify(blank)).toBe(true);
        for (const text of ['a', ' a ', '\u200Ba', '.']) expect(isBlankText(text), JSON.stringify(text)).toBe(false);
    });
    it('uses a custom text of the right language, trimmed', () => {
        const texts = { de: { title: ' Mein WLAN ' }, en: { intro: 'Hello' } };
        expect(pageTexts(texts, 'de')).toMatchObject({ title: 'Mein WLAN' });
        expect(pageTexts(texts, 'en')).toMatchObject({ title: 'My secondary password', intro: 'Hello' });
    });
});
