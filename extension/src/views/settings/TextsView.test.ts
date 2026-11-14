/**
 * App layer (mounted): „Texte“ (spec 4.6, 10.3): per language a title (≤ 60) and an explanation (≤ 300), the default
 * under each empty field, plain text all the way to „Mein Passwort“.
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS, answer, button, cleanup, click, dialog, settle, start } from './settings-harness';

afterEach(cleanup);

const TEXT = {
    title: 'Texte',
    save: 'Speichern',
    saved: '✓ Gespeichert',
    conflict: 'Jemand hat die Einstellungen inzwischen geändert. Lade neu, um die Änderungen zu sehen.',
    missingRight: 'Dir fehlt in ChurchTools das Recht „edit custom data“ auf die Kategorie „settings“.',
    tooLong60: 'Höchstens 60 Zeichen.',
    tooLong300: 'Höchstens 300 Zeichen.',
    deTitle: 'Mein Zweitpasswort',
    deIntro: 'Ein eigenes Passwort für angebundene Dienste wie das WLAN. Es ist unabhängig von deinem ChurchTools-Passwort.',
    enTitle: 'My secondary password',
    enIntro: "A separate password for connected services such as Wi-Fi. It's independent of your ChurchTools password.",
    issuesTitle: 'Ein Teil der gespeicherten Einstellungen ist ungültig und wird nicht verwendet:',
    invalidTitle: 'Die gespeicherten Einstellungen sind ungültig:',
    repairOnRules: 'Repariere sie zuerst unter „Passwortregeln“.',
    bidi: 'Steuerzeichen für die Schreibrichtung (wie U+202E) sind nicht erlaubt.',
};
/** Would be message syntax, a linked message, a plural separator or HTML if it were ever compiled or parsed. */
const ODD = '{x} @:app.name | <b>y</b>';

const field = (w: VueWrapper, lang: 'de' | 'en', part: 'title' | 'intro') => w.find<HTMLInputElement | HTMLTextAreaElement>(`#cps-texts-${lang}-${part}`);
/** The block of one field: label, control, default, counter and error. */
const block = (w: VueWrapper, lang: 'de' | 'en', part: 'title' | 'intro') => w.find(`[data-text-field="${lang}-${part}"]`);
async function type(w: VueWrapper, lang: 'de' | 'en', part: 'title' | 'intro', value: string) {
    await field(w, lang, part).setValue(value);
    await settle();
}
const disabled = (w: VueWrapper, text: string) => button(w, text)!.element.disabled;

describe('Texte (spec 4.6)', () => {
    it('one block per language, each with Titel and Erklärung; empty fields show the default below', async () => {
        const { wrapper } = await start({ path: '/settings/texts' });
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(wrapper.findAll('main h2').map((h) => h.text())).toEqual(['Deutsch', 'Englisch']);
        for (const lang of ['de', 'en'] as const) {
            expect(block(wrapper, lang, 'title').find('label').text()).toBe('Titel');
            expect(block(wrapper, lang, 'intro').find('label').text()).toBe('Erklärung');
            expect(field(wrapper, lang, 'title').element.value).toBe('');
        }
        expect(block(wrapper, 'de', 'title').find('.cps-texts__default').text()).toBe(`Standard: ${TEXT.deTitle}`);
        expect(block(wrapper, 'de', 'intro').find('.cps-texts__default').text()).toBe(`Standard: ${TEXT.deIntro}`);
        expect(block(wrapper, 'en', 'title').find('.cps-texts__default').text()).toBe(`Standard: ${TEXT.enTitle}`);
        expect(block(wrapper, 'en', 'intro').find('.cps-texts__default').text()).toBe(`Standard: ${TEXT.enIntro}`);
    });

    it('a filled field shows its text instead of the default; clearing it brings the default back', async () => {
        const { wrapper } = await start({ path: '/settings/texts', settings: { ...SETTINGS, texts: { de: { title: 'Mein WLAN' } } } });
        expect(field(wrapper, 'de', 'title').element.value).toBe('Mein WLAN');
        expect(block(wrapper, 'de', 'title').find('.cps-texts__default').exists()).toBe(false);
        await type(wrapper, 'de', 'title', '');
        expect(block(wrapper, 'de', 'title').find('.cps-texts__default').text()).toBe(`Standard: ${TEXT.deTitle}`);
    });

    it('counts characters to 60 and 300', async () => {
        const { wrapper } = await start({ path: '/settings/texts' });
        expect(block(wrapper, 'de', 'title').find('.cps-texts__count').text()).toBe('0/60');
        expect(block(wrapper, 'en', 'intro').find('.cps-texts__count').text()).toBe('0/300');
        await type(wrapper, 'de', 'title', 'Hallo');
        expect(block(wrapper, 'de', 'title').find('.cps-texts__count').text()).toBe('5/60');
        await type(wrapper, 'en', 'intro', 'x'.repeat(300));
        expect(block(wrapper, 'en', 'intro').find('.cps-texts__count').text()).toBe('300/300');
        expect(block(wrapper, 'en', 'intro').find('.cps-field__error').exists()).toBe(false);
    });

    it.each([
        ['title', 61, TEXT.tooLong60],
        ['intro', 301, TEXT.tooLong300],
    ] as const)('a %s over its limit (%i): error at the field, Save disabled, nothing written', async (part, n, message) => {
        const { wrapper, writes } = await start({ path: '/settings/texts' });
        await type(wrapper, 'de', part, 'x'.repeat(n));
        const error = block(wrapper, 'de', part).find('.cps-field__error');
        expect(error.text()).toBe(message);
        expect(field(wrapper, 'de', part).attributes('aria-invalid')).toBe('true');
        expect(field(wrapper, 'de', part).attributes('aria-describedby')).toContain(error.attributes('id'));
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        button(wrapper, TEXT.save)!.element.click();
        await settle();
        expect(writes).toEqual([]);
    });

    it('saves only filled fields, keeps the rules, backendUrl and oauthClientId, and says „Gespeichert“', async () => {
        const { wrapper, stored } = await start({ path: '/settings/texts', settings: { ...SETTINGS, texts: { en: { intro: 'Old', future: 1 } } } });
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        await type(wrapper, 'de', 'title', 'Mein WLAN');
        await type(wrapper, 'en', 'intro', '');
        await click(wrapper, TEXT.save);
        expect(await stored()).toEqual({ ...SETTINGS, revision: SETTINGS.revision + 1, texts: { de: { title: 'Mein WLAN' }, en: { future: 1 } } });
        expect(wrapper.find('[role="status"].cps-settings-form__saved').text()).toBe(TEXT.saved);
    });

    it('a blank field (spaces only) counts as empty', async () => {
        const { wrapper, stored } = await start({ path: '/settings/texts', settings: { ...SETTINGS, texts: { de: { title: 'Alt' } } } });
        await type(wrapper, 'de', 'title', '   ');
        expect(block(wrapper, 'de', 'title').find('.cps-texts__default').exists()).toBe(true);
        await click(wrapper, TEXT.save);
        expect(await stored()).not.toHaveProperty('texts');
    });

    it('custom texts are plain text: saved as typed, shown literally here and on „Mein Passwort“', async () => {
        const { wrapper, router, stored } = await start({ path: '/settings/texts' });
        await type(wrapper, 'de', 'title', ODD);
        await type(wrapper, 'de', 'intro', ODD);
        await click(wrapper, TEXT.save);
        expect(await stored()).toMatchObject({ texts: { de: { title: ODD, intro: ODD } } });
        expect(field(wrapper, 'de', 'title').element.value).toBe(ODD);
        await router.push('/');
        await settle();
        // The app's settings were reloaded after the save; the text arrives as is.
        expect(wrapper.find('main h1').text()).toBe(ODD);
        expect(wrapper.find('main').text()).toContain(ODD);
        expect(wrapper.find('main b').exists()).toBe(false);
    });

    it('the stored title comes back literally into the field, and a save of another field leaves it unchanged', async () => {
        const { wrapper, stored } = await start({ path: '/settings/texts', settings: { ...SETTINGS, texts: { de: { title: ODD } } } });
        expect(field(wrapper, 'de', 'title').element.value).toBe(ODD);
        expect(wrapper.find('main b').exists()).toBe(false);
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        await type(wrapper, 'en', 'title', 'Hi');
        await click(wrapper, TEXT.save);
        expect(await stored()).toMatchObject({ texts: { de: { title: ODD }, en: { title: 'Hi' } } });
    });

    it('a text is saved as typed (surrounding spaces included; „Mein Passwort“ trims when showing it)', async () => {
        const { wrapper, stored } = await start({ path: '/settings/texts' });
        await type(wrapper, 'de', 'title', ' Mein WLAN ');
        await click(wrapper, TEXT.save);
        expect(await stored()).toMatchObject({ texts: { de: { title: ' Mein WLAN ' } } });
    });

    it.each([
        ['zero-width space', '\u200B'],
        ['zero-width joiner and spaces', ' \u200D \u2060 '],
        ['soft hyphen', '\u00AD'],
    ])('a text of only invisible characters (%s) counts as empty: default shown, nothing saved', async (_n, value) => {
        const { wrapper, stored } = await start({ path: '/settings/texts', settings: { ...SETTINGS, texts: { de: { title: 'Alt' } } } });
        await type(wrapper, 'de', 'title', value);
        expect(block(wrapper, 'de', 'title').find('.cps-texts__default').exists()).toBe(true);
        await click(wrapper, TEXT.save);
        expect(await stored()).not.toHaveProperty('texts');
    });

    it('a stored text of only invisible characters shows the default below it', async () => {
        const { wrapper } = await start({ path: '/settings/texts', settings: { ...SETTINGS, texts: { de: { title: ' \u200B ' } } } });
        expect(field(wrapper, 'de', 'title').element.value).toBe(' \u200B ');
        expect(block(wrapper, 'de', 'title').find('.cps-texts__default').text()).toBe(`Standard: ${TEXT.deTitle}`);
    });

    it.each([
        ['U+202E', 'abc\u202Edef'],
        ['U+202A', '\u202Ax'],
        ['U+2066', 'x\u2066y'],
        ['U+2069', 'x\u2069'],
    ])('a text with a bidi control (%s) is refused at the field, Save disabled, nothing written', async (_n, value) => {
        const { wrapper, writes } = await start({ path: '/settings/texts' });
        await type(wrapper, 'de', 'intro', value);
        expect(block(wrapper, 'de', 'intro').find('.cps-field__error').text()).toBe(TEXT.bidi);
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        button(wrapper, TEXT.save)!.element.click();
        await settle();
        expect(writes).toEqual([]);
    });

    it('leaving with changes asks first', async () => {
        const { wrapper, router } = await start({ path: '/settings/texts' });
        await type(wrapper, 'de', 'title', 'Neu');
        void router.push('/settings');
        await settle();
        expect(dialog()?.textContent).toContain('Änderungen verwerfen?');
        await answer('Bleiben');
        expect(router.currentRoute.value.path).toBe('/settings/texts');
        expect(field(wrapper, 'de', 'title').element.value).toBe('Neu');
    });

    it('second save with a stale revision reports a conflict', async () => {
        const { wrapper, stored, changeElsewhere } = await start({ path: '/settings/texts' });
        await changeElsewhere({ texts: { de: { title: 'Von woanders' } } });
        await type(wrapper, 'de', 'title', 'Von hier');
        await click(wrapper, TEXT.save);
        expect(wrapper.find('.cps-settings-form__conflict[role="alert"]').text()).toContain(TEXT.conflict);
        expect(await stored()).toMatchObject({ texts: { de: { title: 'Von woanders' } } });
    });
});

describe('Texte: rights and stored problems', () => {
    it('without „edit custom data“ on settings: a banner naming it, no fields, nothing read', async () => {
        const { wrapper, router, storeReads } = await start({ path: '/settings', edit: ['access'] });
        const before = storeReads.settings;
        await router.push('/settings/texts');
        await settle();
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(TEXT.missingRight);
        expect(field(wrapper, 'de', 'title').exists()).toBe(false);
        expect(storeReads.settings).toBe(before);
    });

    it('an invalid value that „Passwortregeln“ can’t repair either: says why, no link there', async () => {
        const { wrapper, openWith } = await start({ path: '/settings' });
        await openWith({ ...SETTINGS, passwordLength: 99, backendUrl: 'http://pw.example' }, '/settings/texts');
        const banner = wrapper.find('.cps-settings-form__issues');
        expect(banner.text()).toContain('Hier lassen sie sich nicht reparieren, weil die Backend-Adresse');
        expect(banner.text()).not.toContain(TEXT.repairOnRules);
    });

    it('stored texts that are invalid are dropped as a whole (valid languages too): shown before saving', async () => {
        const { wrapper } = await start({ path: '/settings/texts', settings: { ...SETTINGS, texts: { de: { title: 'x'.repeat(61) }, en: { title: 'Fine' } } } });
        expect(wrapper.find('.cps-settings-form__issues').text()).toContain(TEXT.issuesTitle);
        expect(field(wrapper, 'en', 'title').element.value).toBe('');
    });

    it('an invalid stored value is repaired on „Passwortregeln“, not here', async () => {
        const { wrapper, openWith, writes } = await start({ path: '/settings' });
        await openWith({ ...SETTINGS, passwordLength: 99 }, '/settings/texts');
        const banner = wrapper.find('.cps-settings-form__issues');
        expect(banner.text()).toContain(TEXT.invalidTitle);
        expect(banner.text()).toContain(TEXT.repairOnRules);
        expect(banner.find('a[href="/settings/rules"]').exists()).toBe(true);
        expect(field(wrapper, 'de', 'title').exists()).toBe(false);
        expect(writes).toEqual([]);
    });
});
