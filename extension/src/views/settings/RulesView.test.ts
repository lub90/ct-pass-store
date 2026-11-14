/**
 * App layer (mounted): „Passwortregeln“ (spec 4.5) and the saving rules of every settings page (spec 4.4): Save and
 * Discard only after a change, „Gespeichert“, conflicts instead of overwriting, asking before leaving.
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS, answer, button, cleanup, click, dialog, settle, start } from './settings-harness';

afterEach(cleanup);

const TEXT = {
    title: 'Passwortregeln',
    requirePrimary: 'ChurchTools-Passwort zur Bestätigung verlangen',
    allowCustom: 'Eigene Passwörter erlauben',
    allowCustomHelp: 'Sonst werden Passwörter nur zufällig erzeugt.',
    lengthHelp: 'Erzeugte Passwörter haben genau diese Länge, selbst gewählte mindestens diese Länge.',
    lengthError: 'Gib eine ganze Zahl von 12 bis 64 ein.',
    save: 'Speichern',
    discard: 'Verwerfen',
    saved: '✓ Gespeichert',
    conflict: 'Jemand hat die Einstellungen inzwischen geändert. Lade neu, um die Änderungen zu sehen.',
    reload: 'Neu laden',
    leaveTitle: 'Änderungen verwerfen?',
    stay: 'Bleiben',
    back: '‹ Einstellungen',
    missingRight: 'Dir fehlt in ChurchTools das Recht „edit custom data“ auf die Kategorie „settings“.',
    rateLimited: 'ChurchTools bremst gerade. Versuch es in einer Minute noch einmal.',
    issuesTitle: 'Ein Teil der gespeicherten Einstellungen ist ungültig und wird nicht verwendet:',
    issuesNote: 'Beim nächsten Speichern wird er entfernt.',
    invalidTitle: 'Die gespeicherten Einstellungen sind ungültig:',
    repairNote: 'Prüf die Werte unten und speichere, um sie zu reparieren. Ungültige Regeln sind mit sicheren Werten vorbelegt.',
    noRepair: 'Hier lassen sie sich nicht reparieren, weil die Backend-Adresse oder die OAuth-Client-ID ungültig ist. Prüf sie unter „Backend & Status“.',
};

const toggle = (w: VueWrapper, label: string) => {
    const found = w.findAll('.cps-toggle').find((t) => t.find('.cps-toggle__label').text() === label);
    if (!found) throw new Error(`No toggle „${label}“`);
    return found.find<HTMLButtonElement>('button[role="switch"]');
};
const length = (w: VueWrapper) => w.find<HTMLInputElement>('#cps-rules-length');
const disabled = (w: VueWrapper, text: string) => button(w, text)!.element.disabled;
async function setLength(w: VueWrapper, value: string) {
    await length(w).setValue(value);
    await settle();
}

describe('Passwortregeln (spec 4.5)', () => {
    it('shows the stored rules with the help texts and a back link', async () => {
        const { wrapper } = await start({ path: '/settings/rules' });
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(toggle(wrapper, TEXT.requirePrimary).attributes('aria-checked')).toBe('true');
        expect(toggle(wrapper, TEXT.allowCustom).attributes('aria-checked')).toBe('false');
        expect(wrapper.text()).toContain(TEXT.allowCustomHelp);
        expect(length(wrapper).element.value).toBe('16');
        expect(wrapper.text()).toContain(TEXT.lengthHelp);
        expect(wrapper.find('main a[href="/settings"]').text()).toBe(TEXT.back);
    });

    it('Save and Discard are disabled until something changes; Discard restores the stored values', async () => {
        const { wrapper } = await start({ path: '/settings/rules' });
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        expect(disabled(wrapper, TEXT.discard)).toBe(true);
        await toggle(wrapper, TEXT.allowCustom).trigger('click');
        expect(disabled(wrapper, TEXT.save)).toBe(false);
        expect(disabled(wrapper, TEXT.discard)).toBe(false);
        await click(wrapper, TEXT.discard);
        expect(toggle(wrapper, TEXT.allowCustom).attributes('aria-checked')).toBe('false');
        expect(disabled(wrapper, TEXT.save)).toBe(true);
    });

    it('changing a value back makes the form clean again', async () => {
        const { wrapper } = await start({ path: '/settings/rules' });
        await setLength(wrapper, '20');
        expect(disabled(wrapper, TEXT.save)).toBe(false);
        await setLength(wrapper, '16');
        expect(disabled(wrapper, TEXT.save)).toBe(true);
    });

    it('saves the rules, keeps backendUrl, oauthClientId and unknown fields, and says „Gespeichert“ (role=status)', async () => {
        const { wrapper, stored } = await start({ path: '/settings/rules', settings: { ...SETTINGS, future: { a: 1 } } });
        await toggle(wrapper, TEXT.allowCustom).trigger('click');
        await toggle(wrapper, TEXT.requirePrimary).trigger('click');
        await setLength(wrapper, '24');
        await click(wrapper, TEXT.save);
        expect(await stored()).toEqual({
            ...SETTINGS,
            revision: SETTINGS.revision + 1,
            requirePasswordForPasswordChange: false,
            allowCustomPassword: true,
            passwordLength: 24,
            future: { a: 1 },
        });
        const saved = wrapper.find('[role="status"].cps-settings-form__saved');
        expect(saved.text()).toBe(TEXT.saved);
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        expect(disabled(wrapper, TEXT.discard)).toBe(true);
        // A further change hides it again.
        await setLength(wrapper, '25');
        expect(wrapper.find('.cps-settings-form__saved').exists()).toBe(false);
    });

    it('two saves in a row use the new revision each time', async () => {
        const { wrapper, stored } = await start({ path: '/settings/rules' });
        await setLength(wrapper, '20');
        await click(wrapper, TEXT.save);
        await setLength(wrapper, '30');
        await click(wrapper, TEXT.save);
        expect(await stored()).toMatchObject({ revision: SETTINGS.revision + 2, passwordLength: 30 });
        expect(wrapper.text()).not.toContain(TEXT.conflict);
    });

    it.each(['11', '65', '', '12.5', 'abc'])('the length field rejects %j: error at the field, Save disabled, nothing written', async (value) => {
        const { wrapper, writes } = await start({ path: '/settings/rules' });
        await setLength(wrapper, value);
        const error = wrapper.find('.cps-field__error');
        expect(error.text()).toBe(TEXT.lengthError);
        expect(length(wrapper).attributes('aria-invalid')).toBe('true');
        expect(length(wrapper).attributes('aria-describedby')).toContain(error.attributes('id'));
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        button(wrapper, TEXT.save)!.element.click();
        await settle();
        expect(writes).toEqual([]);
    });

    it.each([
        ['12', 12],
        ['64', 64],
    ])('the length field accepts %s', async (value, n) => {
        const { wrapper, stored } = await start({ path: '/settings/rules' });
        await setLength(wrapper, value);
        expect(wrapper.find('.cps-field__error').exists()).toBe(false);
        await click(wrapper, TEXT.save);
        expect(await stored()).toMatchObject({ passwordLength: n });
    });

    it('second save with a stale revision reports a conflict', async () => {
        const { wrapper, stored, changeElsewhere } = await start({ path: '/settings/rules' });
        await changeElsewhere({ passwordLength: 40 });
        await toggle(wrapper, TEXT.allowCustom).trigger('click');
        await click(wrapper, TEXT.save);
        const alert = wrapper.find('.cps-settings-form__conflict');
        expect(alert.attributes('role')).toBe('alert');
        expect(alert.text()).toContain(TEXT.conflict);
        // Nothing overwritten: the other save stays as it was.
        expect(await stored()).toMatchObject({ revision: SETTINGS.revision + 1, passwordLength: 40, allowCustomPassword: false });
        expect(wrapper.find('.cps-settings-form__saved').exists()).toBe(false);
        // „Neu laden“ shows the other values; a save from there works.
        await click(wrapper, TEXT.reload);
        expect(length(wrapper).element.value).toBe('40');
        expect(wrapper.find('.cps-settings-form__conflict').exists()).toBe(false);
        await toggle(wrapper, TEXT.allowCustom).trigger('click');
        await click(wrapper, TEXT.save);
        expect(await stored()).toMatchObject({ revision: SETTINGS.revision + 2, passwordLength: 40, allowCustomPassword: true });
    });

    it('a ChurchTools error on save keeps the changes and says what happened', async () => {
        const { wrapper, fakeCt, stored } = await start({ path: '/settings/rules' });
        await setLength(wrapper, '30');
        fakeCt.failNext(429);
        await click(wrapper, TEXT.save);
        expect(wrapper.find('.cps-settings-form__error[role="alert"]').text()).toBe(TEXT.rateLimited);
        expect(length(wrapper).element.value).toBe('30');
        expect(disabled(wrapper, TEXT.save)).toBe(false);
        expect(await stored()).toMatchObject({ passwordLength: 16 });
    });

    it('a save in progress disables Save (no double write)', async () => {
        const { wrapper, writes } = await start({ path: '/settings/rules' });
        await setLength(wrapper, '30');
        button(wrapper, TEXT.save)!.element.click();
        button(wrapper, TEXT.save)!.element.click();
        await settle();
        expect(writes).toHaveLength(1);
    });
});

describe('leaving with changes', () => {
    it('asks first; „Bleiben“ stays with the changes, „Verwerfen“ leaves', async () => {
        const { wrapper, router } = await start({ path: '/settings/rules' });
        await setLength(wrapper, '30');
        void router.push('/settings');
        await settle();
        expect(dialog()?.textContent).toContain(TEXT.leaveTitle);
        await answer(TEXT.stay);
        expect(router.currentRoute.value.path).toBe('/settings/rules');
        expect(length(wrapper).element.value).toBe('30');
        void router.push('/settings');
        await settle();
        await answer(TEXT.discard);
        expect(router.currentRoute.value.path).toBe('/settings');
    });

    it('does not ask without changes, nor after saving', async () => {
        const { wrapper, router } = await start({ path: '/settings/rules' });
        await router.push('/settings');
        await settle();
        expect(dialog()).toBeNull();
        await router.push('/settings/rules');
        await settle();
        await setLength(wrapper, '30');
        await click(wrapper, TEXT.save);
        await router.push('/settings');
        await settle();
        expect(dialog()).toBeNull();
        expect(router.currentRoute.value.path).toBe('/settings');
    });

    it('the browser asks before closing or reloading the tab while there are changes', async () => {
        const { wrapper } = await start({ path: '/settings/rules' });
        const clean = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);
        await setLength(wrapper, '30');
        const dirty = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirty);
        expect(dirty.defaultPrevented).toBe(true);
    });
});

describe('rights (spec 8.1)', () => {
    it('without „edit custom data“ on settings: a banner naming it, no form, nothing read', async () => {
        const { wrapper, router, storeReads: reads } = await start({ path: '/settings', edit: ['access'] });
        const before = reads.settings;
        await router.push('/settings/rules');
        await settle();
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(TEXT.missingRight);
        expect(wrapper.find('#cps-rules-length').exists()).toBe(false);
        expect(button(wrapper, TEXT.save)).toBeUndefined();
        expect(reads.settings).toBe(before);
    });
});

describe('what the stored value lacks', () => {
    it('shows dropped parts (invalid texts) before saving: a save removes them', async () => {
        const { wrapper, stored } = await start({ path: '/settings/rules', settings: { ...SETTINGS, texts: { de: { title: 'x'.repeat(61) }, en: { title: 'Fine' } } } });
        const banner = wrapper.find('.cps-settings-form__issues');
        expect(banner.text()).toContain(TEXT.issuesTitle);
        expect(banner.text()).toContain('texts.de.title');
        expect(banner.text()).toContain(TEXT.issuesNote);
        await setLength(wrapper, '20');
        await click(wrapper, TEXT.save);
        expect(await stored()).not.toHaveProperty('texts');
    });

    it('an invalid stored value: the issues, safe values for broken rules, an explicit repair save with the stored revision', async () => {
        const broken = { ...SETTINGS, revision: 9, passwordLength: 99, allowCustomPassword: 'yes' };
        const { wrapper, stored, openWith } = await start({ path: '/settings' });
        await openWith(broken, '/settings/rules');
        const banner = wrapper.find('.cps-settings-form__issues');
        expect(banner.text()).toContain(TEXT.invalidTitle);
        expect(banner.text()).toContain('passwordLength');
        expect(banner.text()).toContain(TEXT.repairNote);
        expect(length(wrapper).element.value).toBe('16');
        expect(toggle(wrapper, TEXT.allowCustom).attributes('aria-checked')).toBe('false');
        // Kept as stored: valid on its own.
        expect(toggle(wrapper, TEXT.requirePrimary).attributes('aria-checked')).toBe('true');
        expect(disabled(wrapper, TEXT.save)).toBe(false);
        await click(wrapper, TEXT.save);
        expect(await stored()).toEqual({ ...SETTINGS, revision: 10, passwordLength: 16, allowCustomPassword: false });
        expect(wrapper.find('.cps-settings-form__issues').exists()).toBe(false);
    });

    it('an invalid backendUrl or oauthClientId: no repair here (these pages never write them)', async () => {
        const { wrapper, writes, openWith } = await start({ path: '/settings' });
        await openWith({ ...SETTINGS, passwordLength: 99, oauthClientId: '' }, '/settings/rules');
        expect(wrapper.find('.cps-settings-form__issues').text()).toContain(TEXT.noRepair);
        expect(wrapper.find('#cps-rules-length').exists()).toBe(false);
        expect(button(wrapper, TEXT.save)).toBeUndefined();
        expect(writes).toEqual([]);
    });

    it('issues are plain text', async () => {
        const { wrapper, openWith } = await start({ path: '/settings' });
        await openWith({ ...SETTINGS, passwordLength: '<b>x</b>' }, '/settings/rules');
        expect(wrapper.find('.cps-settings-form__issues b').exists()).toBe(false);
    });
});
