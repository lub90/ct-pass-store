/**
 * App layer (mounted): duplicate `settings` and `access` values (spec 6.2, point B E1). None of them wins silently:
 * the settings pages show every value and let an editor choose which stays; only then a guarded resolve deletes the
 * others. A save never deletes values nobody has seen.
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS, ACCESS_VALUE_ID, SETTINGS, SETTINGS_VALUE_ID, answer, button, cleanup, click, dialog, settle, start } from './settings-harness';

afterEach(cleanup);

const TEXT = {
    title: 'Mehrere Werte gespeichert',
    intro: (category: string, n: number) => `In „${category}“ sind ${n} Werte gespeichert. Die Erweiterung und das Backend verwenden keinen davon, bis du auswählst, welcher bleibt; die anderen werden dann gelöscht.`,
    warning: 'Einen Wert, den niemand von euch angelegt hat, kann jemand untergeschoben haben. Prüf vor allem die Backend-Adresse und die Maschinen-Clients.',
    keep: 'Diesen Wert behalten',
    confirm: 'Behalten und andere löschen',
    cancel: 'Abbrechen',
    conflict: 'Die gespeicherten Werte haben sich inzwischen geändert. Es wurde nichts gelöscht. Lade neu, um sie zu sehen.',
    reload: 'Neu laden',
    done: (id: number) => `Wert ${id} bleibt, die anderen sind gelöscht.`,
    reloadNote: 'Lade die Seite neu, damit die Erweiterung ihn verwendet.',
    reloadPage: 'Seite neu laden',
    save: 'Speichern',
    settingsConflict: 'Jemand hat die Einstellungen inzwischen geändert. Lade neu, um die Änderungen zu sehen.',
};

const PLANTED = { ...SETTINGS, revision: 9, backendUrl: 'https://evil.example', oauthClientId: 'evil-client' };
const key = (c: string) => btoa(c.repeat(32));
const READER = { id: 'reader', name: 'Spion', publicKeys: [key('s')], permissions: ['entries:read'], createdAt: '2026-01-01' };

const card = (w: VueWrapper, id: number) => w.find(`.cps-duplicates__value[data-value-id="${id}"]`);
const keepButton = (w: VueWrapper, id: number) => card(w, id).findAll('button').find((b) => b.text() === TEXT.keep);

async function keep(w: VueWrapper, id: number): Promise<void> {
    const b = keepButton(w, id);
    if (!b) throw new Error(`No keep button for value ${id}`);
    (b.element as HTMLButtonElement).click();
    await settle();
}

describe('duplicate settings at startup', () => {
    it.each(['/settings/rules', '/settings/texts', '/settings/backend'])('%s shows every value instead of the form; nothing goes to any backend', async (path) => {
        const { wrapper, backendUrls, selfTests } = await start({ path, extra: [{ category: 'settings', value: PLANTED }] });
        expect(wrapper.find('.cps-duplicates').exists()).toBe(true);
        expect(wrapper.text()).toContain(TEXT.title);
        expect(wrapper.text()).toContain(TEXT.intro('settings', 2));
        expect(wrapper.text()).toContain(TEXT.warning);
        expect(button(wrapper, TEXT.save)).toBeUndefined();
        expect(wrapper.find('form').exists()).toBe(false);
        // Oldest first, the newest (most likely planted) labelled (S2); each with its id, revision and address (isolated).
        expect(wrapper.findAll('.cps-duplicates__value').map((c) => c.attributes('data-value-id'))).toEqual([String(SETTINGS_VALUE_ID), '301']);
        expect(card(wrapper, 301).find('.cps-duplicates__newest').text()).toBe('· zuletzt angelegt');
        expect(card(wrapper, SETTINGS_VALUE_ID).find('.cps-duplicates__newest').exists()).toBe(false);
        // Booleans as yes/no.
        expect(card(wrapper, 301).find('[data-field="requirePasswordForPasswordChange"] dd').text()).toBe('Ja');
        expect(card(wrapper, 301).find('[data-field="allowCustomPassword"] dd').text()).toBe('Nein');
        expect(card(wrapper, 301).text()).toContain('Wert 301');
        expect(card(wrapper, 301).text()).toContain('Revision 9');
        expect(card(wrapper, 301).find('[data-field="backendUrl"] bdi').text()).toBe('https://evil.example');
        expect(card(wrapper, 301).find('[data-field="backendUrl"]').text()).toContain('unterschiedlich');
        expect(card(wrapper, 301).find('[data-field="passwordLength"]').text()).not.toContain('unterschiedlich');
        expect(card(wrapper, SETTINGS_VALUE_ID).find('[data-field="backendUrl"] bdi').text()).toBe(SETTINGS.backendUrl);
        expect(backendUrls).toEqual([]);
        expect(selfTests).toEqual([]);
    });

    it('keeping a value asks first (naming the values to delete), then deletes the others and keeps the chosen one', async () => {
        const reloadPage = vi.fn();
        const { wrapper, all, writes } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: PLANTED }], reloadPage });
        await keep(wrapper, SETTINGS_VALUE_ID);
        expect(dialog()?.textContent).toContain(`Wert ${SETTINGS_VALUE_ID}`);
        expect(dialog()?.textContent).toContain('Die anderen Werte werden gelöscht: Wert 301. Das lässt sich nicht rückgängig machen.');
        // The address differs between the values: the dialog names the kept one's (S1); it is a danger dialog (I1).
        expect(dialog()?.textContent).toContain(`Backend-Adresse dieses Werts: \u2068${SETTINGS.backendUrl}\u2069.`);
        expect(dialog()?.textContent).toContain('OAuth-Client-ID dieses Werts: \u2068oauth-client-1\u2069.');
        expect(dialog()?.textContent).not.toContain('Passwortlänge');
        expect(document.activeElement?.textContent?.trim()).toBe(TEXT.cancel);
        expect(dialog()?.querySelector('.cps-btn--danger')?.textContent?.trim()).toBe(TEXT.confirm);
        // Busy while asking: no second question (C12).
        expect(keepButton(wrapper, 301)!.attributes('disabled')).toBeDefined();
        expect(writes).toEqual([]);
        await answer(TEXT.confirm);
        // Kept unchanged but for a revision above every value's revision, so no stale page overwrites it.
        expect(await all('settings')).toEqual([{ id: SETTINGS_VALUE_ID, value: { ...SETTINGS, revision: 10 } }]);
        expect(wrapper.text()).toContain(TEXT.done(SETTINGS_VALUE_ID));
        // The app started without settings (row 4a): only a page load uses the kept value.
        expect(wrapper.text()).toContain(TEXT.reloadNote);
        // The page reads again: the rules form of the kept value.
        expect(wrapper.find('#cps-rules-length').exists()).toBe(true);
        await click(wrapper, TEXT.reloadPage);
        expect(reloadPage).toHaveBeenCalledOnce();
    });

    it('after resolving, a save works but still nothing goes to any backend before the page load (startup address kept)', async () => {
        const { wrapper, all, backendUrls, router } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: PLANTED }] });
        await keep(wrapper, 301);
        await answer(TEXT.confirm);
        await wrapper.find('#cps-rules-length').setValue('20');
        await settle();
        await click(wrapper, TEXT.save);
        expect(await all('settings')).toEqual([{ id: 301, value: { ...PLANTED, revision: 11, passwordLength: 20 } }]);
        await router.push('/settings/backend');
        await settle();
        await router.push('/settings');
        await settle();
        expect(backendUrls).toEqual([]);
    });

    it('cancelling deletes nothing', async () => {
        const { wrapper, all } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: PLANTED }] });
        await keep(wrapper, 301);
        await answer(TEXT.cancel);
        expect(await all('settings')).toHaveLength(2);
        expect(wrapper.find('.cps-duplicates').exists()).toBe(true);
    });

    it('a value that changed or appeared meanwhile: conflict, nothing deleted; reloading shows the new list', async () => {
        const { wrapper, all, plant } = await start({ path: '/settings/backend', extra: [{ category: 'settings', value: PLANTED }] });
        const third = await plant('settings', { ...SETTINGS, backendUrl: 'https://third.example' });
        await keep(wrapper, SETTINGS_VALUE_ID);
        await answer(TEXT.confirm);
        expect(wrapper.find('.cps-duplicates__error[role="alert"]').text()).toContain(TEXT.conflict);
        expect(await all('settings')).toHaveLength(3);
        await click(wrapper, TEXT.reload);
        expect(card(wrapper, third).exists()).toBe(true);
        expect(wrapper.text()).toContain(TEXT.intro('settings', 3));
    });

    it('a value that can\'t be kept (broken JSON, newer schema) has no keep button, but is shown', async () => {
        const { wrapper } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: '{nope' }, { category: 'settings', value: { ...SETTINGS, schema: 2, passwordLength: 5 } }] });
        expect(keepButton(wrapper, 301)).toBeUndefined();
        expect(card(wrapper, 301).text()).toContain('ungültig');
        expect(card(wrapper, 301).text()).toContain('Kann nicht behalten werden.');
        expect(keepButton(wrapper, 302)).toBeDefined();
        expect(keepButton(wrapper, SETTINGS_VALUE_ID)).toBeDefined();
    });

    it('stored texts stay plain text and isolated; the real host and invisible characters are named', async () => {
        const hostile = { ...SETTINGS, backendUrl: 'https://pw.example%2eevil.com', oauthClientId: '<img src=x onerror=alert(1)>‮' };
        const invisible = { ...SETTINGS, backendUrl: 'https://p​w.example' };
        const { wrapper } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: hostile }, { category: 'settings', value: invisible }] });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(card(wrapper, 301).find('[data-field="oauthClientId"] bdi').text()).toBe('<img src=x onerror=alert(1)>‮');
        expect(card(wrapper, 301).find('[data-field="backendUrl"]').text()).toContain('tatsächlicher Host:');
        expect(card(wrapper, 301).find('[data-field="backendUrl"] .cps-duplicates__host bdi').text()).toBe('pw.example.evil.com');
        expect(card(wrapper, 302).find('[data-field="backendUrl"]').text()).toContain('enthält unsichtbare Zeichen');
        expect(card(wrapper, SETTINGS_VALUE_ID).find('[data-field="backendUrl"]').text()).not.toContain('unsichtbare');
    });

    it('a stale save never deletes the duplicate that appeared after the page was read; reloading shows both', async () => {
        const { wrapper, plant, all } = await start({ path: '/settings/rules' });
        expect(wrapper.find('#cps-rules-length').exists()).toBe(true);
        const planted = await plant('settings', PLANTED);
        await wrapper.find('#cps-rules-length').setValue('20');
        await settle();
        await click(wrapper, TEXT.save);
        expect(wrapper.text()).toContain(TEXT.settingsConflict);
        expect((await all('settings')).map((v) => v.id)).toEqual([SETTINGS_VALUE_ID, planted]);
        expect(await all('settings')).toContainEqual({ id: SETTINGS_VALUE_ID, value: SETTINGS });
        await click(wrapper, TEXT.reload);
        expect(wrapper.find('.cps-duplicates').exists()).toBe(true);
        // During a visit with a running backend: resolving doesn't ask for a page load.
        await keep(wrapper, SETTINGS_VALUE_ID);
        await answer(TEXT.confirm);
        expect(wrapper.text()).toContain(TEXT.done(SETTINGS_VALUE_ID));
        expect(wrapper.text()).not.toContain(TEXT.reloadNote);
    });

    it.each([
        ['without the delete right', { noDelete: true }, 'Dir fehlt in ChurchTools das Recht „delete custom data“ auf die Kategorie „settings“.'],
        ['when ChurchTools fails the delete', { failDelete: true }, 'ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.'],
    ])('a delete that fails after the update (%s): the error shows, nothing is reported done, the duplicates stay (I2)', async (_n, o, text) => {
        const { wrapper, all } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: PLANTED }], ...o });
        await keep(wrapper, SETTINGS_VALUE_ID);
        await answer(TEXT.confirm);
        expect(wrapper.find('.cps-duplicates__error[role="alert"]').text()).toBe(text);
        expect(wrapper.text()).not.toContain(TEXT.done(SETTINGS_VALUE_ID));
        expect(wrapper.find('.cps-duplicates').exists()).toBe(true);
        // Value first: the kept one is updated (revision raised), the planted one is still there, so still no value wins.
        expect(await all('settings')).toEqual([
            { id: SETTINGS_VALUE_ID, value: { ...SETTINGS, revision: 10 } },
            { id: 301, value: PLANTED },
        ]);
        // The shown list is stale now: keeping again is a conflict; reloading shows the current values.
        await keep(wrapper, SETTINGS_VALUE_ID);
        await answer(TEXT.confirm);
        expect(wrapper.find('.cps-duplicates__error[role="alert"]').text()).toContain(TEXT.conflict);
        await click(wrapper, TEXT.reload);
        expect(card(wrapper, SETTINGS_VALUE_ID).text()).toContain('Revision 10');
    });

    it('leaving the page while the question is open sends nothing (C3)', async () => {
        const { wrapper, all, store, router } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: PLANTED }] });
        const resolve = vi.spyOn(store, 'resolveDuplicates');
        await keep(wrapper, SETTINGS_VALUE_ID);
        await router.push('/settings');
        await settle();
        await answer(TEXT.confirm);
        expect(resolve).not.toHaveBeenCalled();
        expect(await all('settings')).toHaveLength(2);
    });

    it('a value whose address a save would refuse has no keep button, with the reason (S6)', async () => {
        const { wrapper } = await start({ path: '/settings/rules', extra: [{ category: 'settings', value: { ...SETTINGS, backendUrl: 'https://pw.example%2eevil.com' } }] });
        expect(keepButton(wrapper, 301)).toBeUndefined();
        expect(card(wrapper, 301).text()).toContain('Kann nicht behalten werden: Die Backend-Adresse enthält unsichtbare Zeichen oder einen Host, den der Browser anders schreibt.');
        expect(keepButton(wrapper, SETTINGS_VALUE_ID)).toBeDefined();
    });

    it('a hostile revision, other field names and the real host are isolated in the page; the dialog names the kept address where they differ (C8, C15, S1)', async () => {
        const odd = { ...SETTINGS, backendUrl: 'https://pw.example%2eevil.com', revision: 'r\u202Ex', ['x\u202Ey']: 1 };
        const { wrapper } = await start({ path: '/settings/rules', settings: odd, extra: [{ category: 'settings', value: SETTINGS }] });
        expect(card(wrapper, SETTINGS_VALUE_ID).find('.cps-duplicates__revision bdi').text()).toBe('r\u202Ex');
        expect(card(wrapper, SETTINGS_VALUE_ID).find('.cps-duplicates__other bdi').text()).toBe('x\u202Ey');
        expect(card(wrapper, 301).find('.cps-duplicates__revision bdi').exists()).toBe(false);
        await keep(wrapper, 301);
        expect(dialog()?.textContent).toContain(`Backend-Adresse dieses Werts: \u2068${SETTINGS.backendUrl}\u2069.`);
        await answer(TEXT.cancel);
    });

    it('after resolving during a visit, a kept address other than the running one asks for a page load (S7)', async () => {
        const { wrapper, plant } = await start({ path: '/settings/rules' });
        const planted = await plant('settings', { ...SETTINGS, backendUrl: 'https://other.example' });
        await wrapper.find('#cps-rules-length').setValue('20');
        await settle();
        await click(wrapper, TEXT.save);
        await click(wrapper, TEXT.reload);
        await keep(wrapper, planted);
        await answer(TEXT.confirm);
        expect(wrapper.text()).toContain(TEXT.done(planted));
        expect(wrapper.text()).toContain(TEXT.reloadNote);
    });

    it('the overview names the category and links the page that resolves it', async () => {
        const { wrapper } = await start({ path: '/settings', extra: [{ category: 'settings', value: PLANTED }, { category: 'access', value: ACCESS }] });
        const banner = wrapper.find('.cps-settings__duplicates');
        expect(banner.text()).toContain('In ChurchTools sind mehrere Werte für „settings, access“ gespeichert.');
        expect(banner.find('a[href="/settings/rules"]').exists()).toBe(true);
        expect(banner.find('a[href="/settings/access"]').exists()).toBe(true);
    });
});

describe('duplicate access values („Zugriff“)', () => {
    const plantedAccess = { ...ACCESS, revision: 3, groups: { ...ACCESS.groups, admins: { groupId: 66, createdBySetup: true } }, machineClients: [READER] };

    it('shows each value with its groups and active clients (the extra reader, with fingerprint); nothing of it is active', async () => {
        const { wrapper } = await start({ path: '/settings/access', extra: [{ category: 'access', value: plantedAccess }] });
        expect(wrapper.text()).toContain(TEXT.intro('access', 2));
        expect(wrapper.find('.cps-access__clients').exists()).toBe(false);
        const planted = card(wrapper, 301);
        expect(planted.find('[data-field="groups.admins"]').text()).toContain('66');
        expect(planted.find('[data-field="groups.admins"]').text()).toContain('unterschiedlich');
        const client = planted.find('.cps-duplicates__client');
        expect(client.find('bdi').text()).toBe('Spion');
        expect(client.text()).toContain('reader');
        expect(client.text()).toContain('darf lesen');
        expect(client.find('code').text()).toMatch(/^[A-Za-z0-9_-]{16}$/);
        expect(card(wrapper, ACCESS_VALUE_ID).text()).toContain('keine aktiven Maschinen-Clients');
    });

    it('the dialog of the planted value names its other admin group and its active clients (S1)', async () => {
        const { wrapper } = await start({ path: '/settings/access', extra: [{ category: 'access', value: plantedAccess }] });
        await keep(wrapper, 301);
        const text = dialog()?.textContent ?? '';
        expect(text).toContain('Gruppe „Admins“ dieses Werts: 66.');
        expect(text).not.toContain('Gruppe „Nutzer“');
        expect(text).toMatch(/Aktive Maschinen-Clients dieses Werts: \u2068Spion\u2069 \(\u2068reader\u2069, darf lesen, Fingerabdrücke [A-Za-z0-9_-]{16}\)\./);
        await answer(TEXT.cancel);
        await keep(wrapper, ACCESS_VALUE_ID);
        expect(dialog()?.textContent).toContain('Dieser Wert hat keine aktiven Maschinen-Clients.');
        await answer(TEXT.cancel);
    });

    it('the active-client lists are marked when they differ, and disabled entries are counted (S3, C10)', async () => {
        const { wrapper } = await start({ path: '/settings/access', extra: [{ category: 'access', value: { ...plantedAccess, machineClients: [READER, { id: 'kaputt' }] } }] });
        expect(card(wrapper, 301).text()).toContain('Aktive Maschinen-Clients: · unterschiedlich');
        expect(card(wrapper, ACCESS_VALUE_ID).text()).toContain('keine aktiven Maschinen-Clients · unterschiedlich');
        expect(card(wrapper, 301).text()).toContain('Ein falsch konfigurierter Eintrag.');
        expect(card(wrapper, ACCESS_VALUE_ID).text()).not.toContain('falsch konfiguriert');
    });

    it('keeping the original removes the planted reader; the page then shows the kept value', async () => {
        const { wrapper, all } = await start({ path: '/settings/access', extra: [{ category: 'access', value: plantedAccess }] });
        await keep(wrapper, ACCESS_VALUE_ID);
        expect(dialog()?.textContent).toContain('Wert 301');
        await answer(TEXT.confirm);
        expect(await all('access')).toEqual([{ id: ACCESS_VALUE_ID, value: { ...ACCESS, revision: 4 } }]);
        expect(wrapper.text()).toContain(TEXT.done(ACCESS_VALUE_ID));
        // Startup access duplicates (row 4a): only a page load uses the kept value (P1).
        expect(wrapper.text()).toContain(TEXT.reloadNote);
        expect(button(wrapper, TEXT.reloadPage)).toBeDefined();
        expect(wrapper.find('.cps-duplicates').exists()).toBe(false);
        expect(wrapper.text()).toContain('Noch keine Clients.');
    });

    it('a planted duplicate never becomes active by a save on the client form', async () => {
        const { wrapper, plant, all } = await start({ path: '/settings/access/clients/new' });
        await plant('access', plantedAccess);
        await wrapper.find('#cps-client-name').setValue('WLAN');
        await settle();
        const keyInput = wrapper.find<HTMLInputElement>('#cps-client-key-0');
        await keyInput.setValue(key('w'));
        await settle();
        await click(wrapper, TEXT.save);
        expect(wrapper.text()).toContain(TEXT.settingsConflict);
        expect(await all('access')).toEqual([
            { id: ACCESS_VALUE_ID, value: ACCESS },
            { id: expect.any(Number), value: plantedAccess },
        ]);
    });

    it('access duplicates at startup, settings resolved later: no page-load hint for the settings (P2)', async () => {
        const { wrapper, plant, router } = await start({ path: '/settings/access', extra: [{ category: 'access', value: plantedAccess }] });
        const planted = await plant('settings', { ...SETTINGS, revision: 2 });
        await router.push('/settings/rules');
        await settle();
        await keep(wrapper, SETTINGS_VALUE_ID);
        await answer(TEXT.confirm);
        expect(wrapper.text()).toContain(TEXT.done(SETTINGS_VALUE_ID));
        expect(wrapper.text()).not.toContain(TEXT.reloadNote);
        expect(planted).toBeGreaterThan(0);
    });

    it('the client form shows the values to choose from too', async () => {
        const { wrapper } = await start({ path: '/settings/access/clients/new', extra: [{ category: 'access', value: plantedAccess }] });
        expect(wrapper.find('.cps-duplicates').exists()).toBe(true);
        expect(card(wrapper, 301).find('.cps-duplicates__client bdi').text()).toBe('Spion');
    });
});
