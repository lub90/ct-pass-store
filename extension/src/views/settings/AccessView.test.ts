/**
 * App layer (mounted): „Zugriff“ (spec 4.7): the warning, the users and admins groups, the machine clients with
 * removal, and the stored entries the backend can't use („falsch konfiguriert“, USER DECISION 2026-11-14).
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CtHttpError } from '../../ct/errors';
import { ACCESS, ME, ORIGIN, answer, button, cleanup, click, dialog, settle, start } from './settings-harness';

afterEach(cleanup);

const TEXT = {
    title: 'Zugriff',
    warning: 'Wer hier etwas ändern kann, hat Zugriff auf alle Passwörter. Halt diesen Kreis sehr klein.',
    missingRight: 'Dir fehlt in ChurchTools das Recht „edit custom data“ auf die Kategorie „access“.',
    membersHint: 'Mitglieder verwaltest du in ChurchTools.',
    open: 'In ChurchTools öffnen ↗',
    change: 'Gruppe ändern',
    changeLater: 'Kommt mit dem Einrichtungsassistenten.',
    users: 'Nutzer',
    admins: 'Admins',
    canRead: 'darf lesen',
    edit: 'Bearbeiten',
    remove: 'Entfernen',
    add: '+ Client hinzufügen',
    cancel: 'Abbrechen',
    within5: 'Wirkt innerhalb von 5 Minuten.',
    removeTitle: 'Client entfernen?',
    brokenTitle: 'Falsch konfiguriert',
    brokenRemoveTitle: 'Eintrag entfernen?',
    conflict: 'Jemand hat die Einstellungen inzwischen geändert. Lade neu, um die Änderungen zu sehen.',
    empty: 'Noch keine Clients. Füg einen hinzu, wenn ein Dienst wie ein WLAN-RADIUS-Server Passwörter lesen soll.',
    creatorNote: 'Ein Client bleibt gültig, wenn die Person, die ihn angelegt hat, die Gemeinde verlässt oder kein Admin mehr ist. Entferne Clients, die niemand mehr braucht.',
};

const key = (n: number) => Buffer.alloc(32, n).toString('base64');
const client = (id: string, name: string, keys: string[], extra: Record<string, unknown> = {}) => ({ id, name, publicKeys: keys, permissions: ['entries:read'], createdAt: '2026-11-01', ...extra });
const GROUPS = [
    { id: 40, name: 'CtPassStore Nutzer', memberIds: [ME, 2, 3], inactiveMemberIds: [4] },
    { id: 41, name: 'CtPassStore Admins', memberIds: [ME] },
    { id: 42, name: 'CtPassStore API', memberIds: [9] },
];
const PERSONS = [
    { id: 2, firstName: 'Bert', lastName: 'B' },
    { id: 3, firstName: 'Cleo', lastName: 'C' },
    { id: 4, firstName: 'Dora', lastName: 'D' },
    { id: 9, firstName: 'Service', lastName: 'User' },
];
const open = (o: Parameters<typeof start>[0]) => start({ groups: GROUPS, viewGroupIds: [40], persons: PERSONS, ...o, path: o.path });
const access = (machineClients: unknown[]) => ({ ...ACCESS, machineClients });

const group = (w: VueWrapper, role: 'users' | 'admins') => w.find(`[data-role="${role}"]`);
const row = (w: VueWrapper, id: string) => w.find(`[data-client-id="${id}"]`);
const broken = (w: VueWrapper) => w.findAll('.cps-access__broken-entry');
const rowButton = (w: ReturnType<typeof row>, text: string) => w.findAll('button').find((b) => b.text() === text);

describe('Zugriff (spec 4.7)', () => {
    it('without edit custom data on access: names the right, reads nothing', async () => {
        const { wrapper, storeReads, router } = await open({ path: '/settings', edit: ['settings'] });
        const before = storeReads.access;
        await router.push('/settings/access');
        await settle();
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(TEXT.missingRight);
        expect(storeReads.access).toBe(before);
        expect(wrapper.find('[data-role]').exists()).toBe(false);
        expect(button(wrapper, TEXT.add)).toBeUndefined();
    });

    it('shows the warning banner and a back link', async () => {
        const { wrapper } = await open({ path: '/settings/access' });
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(wrapper.find('.cps-access__warning').text()).toContain(TEXT.warning);
        expect(wrapper.find('.cps-access__warning').text()).toContain('Admin-Gruppe');
        expect(wrapper.find('.cps-access__back a[href="/settings"]').text()).toBe('‹ Einstellungen');
    });

    it('shows the users and admins groups with name, active member count, the hint and the link into ChurchTools', async () => {
        const { wrapper } = await open({ path: '/settings/access' });
        const users = group(wrapper, 'users');
        expect(users.find('.cps-access__role').text()).toBe(TEXT.users);
        expect(users.find('.cps-access__group-name').text()).toBe('CtPassStore Nutzer');
        // Only active members count (the inactive one doesn't).
        expect(users.find('.cps-access__group-count').text()).toBe('3 Mitglieder');
        expect(users.text()).toContain(TEXT.membersHint);
        const link = users.find('a.cps-access__group-link');
        expect(link.text()).toBe(TEXT.open);
        expect(link.attributes('href')).toBe(`${ORIGIN}/groups/40/dashboard`);
        expect(link.attributes('target')).toBe('_blank');
        expect(link.attributes('rel')).toBe('noopener noreferrer');
        const admins = group(wrapper, 'admins');
        expect(admins.find('.cps-access__role').text()).toBe(TEXT.admins);
        expect(admins.find('.cps-access__group-name').text()).toBe('CtPassStore Admins');
        expect(admins.find('.cps-access__group-count').text()).toBe('1 Mitglied');
        expect(admins.find('a.cps-access__group-link').attributes('href')).toBe(`${ORIGIN}/groups/41/dashboard`);
        // The service user's group is shown on „Einrichtung“, not here.
        expect(wrapper.find('[data-role="service"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('CtPassStore API');
    });

    it('„Gruppe ändern“ is shown disabled, with the hint that it comes with the setup assistant (spec 12.6)', async () => {
        const { wrapper } = await open({ path: '/settings/access' });
        for (const role of ['users', 'admins'] as const) {
            const b = group(wrapper, role).findAll('button').find((x) => x.text() === TEXT.change);
            expect(b?.element.disabled).toBe(true);
            const hint = wrapper.find(`#${b!.attributes('aria-describedby')}`);
            expect(hint.text()).toBe(TEXT.changeLater);
        }
    });

    it('a deleted group shows the error with the fix (setup-capable: on „Einrichtung“)', async () => {
        const { wrapper } = await open({ path: '/settings/access', groups: GROUPS.filter((g) => g.id !== 41), setupCapable: true });
        const admins = group(wrapper, 'admins');
        const error = admins.find('.cps-access__group-error');
        expect(error.attributes('role')).toBe('alert');
        expect(error.text()).toContain('Die Gruppe mit der ID 41 gibt es in ChurchTools nicht mehr.');
        expect(error.text()).toContain('Ordne unter „Einrichtung“ eine andere Gruppe zu.');
        expect(admins.find('.cps-access__group-count').exists()).toBe(false);
        // The other group still shows.
        expect(group(wrapper, 'users').find('.cps-access__group-name').text()).toBe('CtPassStore Nutzer');
    });

    it('a deleted group, for an editor who can’t run the setup: says whom to turn to', async () => {
        const { wrapper } = await open({ path: '/settings/access', groups: GROUPS.filter((g) => g.id !== 40), setupCapable: false });
        const error = group(wrapper, 'users').find('.cps-access__group-error');
        expect(error.text()).toContain('Die Gruppe mit der ID 40 gibt es in ChurchTools nicht mehr.');
        expect(error.text()).toContain('Wende dich an jemanden, der die Einrichtung ausführen darf.');
    });

    it('another ChurchTools failure on a group read: says ChurchTools isn’t answering, no „deleted“ claim', async () => {
        const { wrapper, router, ct } = await open({ path: '/settings' });
        vi.spyOn(ct, 'group').mockRejectedValue(new CtHttpError(500));
        await router.push('/settings/access');
        await settle();
        const error = group(wrapper, 'users').find('.cps-access__group-error');
        expect(error.text()).toBe('ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.');
    });

    it('a group the person may not see names the missing right', async () => {
        const notMember = [{ ...GROUPS[0]!, memberIds: [2, 3] }, GROUPS[1]!];
        const { wrapper } = await open({ path: '/settings/access', groups: notMember, viewGroupIds: [] });
        const error = group(wrapper, 'users').find('.cps-access__group-error');
        expect(error.text()).toBe('Dir fehlt in ChurchTools das Recht „view group“ auf die Gruppe mit der ID 40.');
        // A member can read their own group (A4).
        expect(group(wrapper, 'admins').find('.cps-access__group-name').text()).toBe('CtPassStore Admins');
    });

    it('lists the machine clients with name, id, permission, number of keys, createdAt, creator and actions', async () => {
        const { wrapper } = await open({
            path: '/settings/access',
            access: access([client('wlan-radius', 'WLAN RADIUS', [key(1), key(2)], { createdBy: ME }), client('other', 'Anderer', [key(3)], { permissions: [], createdBy: 77 })]),
        });
        const radius = row(wrapper, 'wlan-radius');
        expect(radius.find('.cps-access__client-name').text()).toBe('WLAN RADIUS');
        expect(radius.find('.cps-access__client-id').text()).toBe('wlan-radius');
        expect(radius.text()).toContain(TEXT.canRead);
        expect(radius.text()).toContain('2 Schlüssel');
        expect(radius.text()).toContain('angelegt am 2026-11-01 von Anna Admin');
        expect(radius.find('a').attributes('href')).toBe('/settings/access/clients/wlan-radius');
        expect(radius.find('a').text()).toBe(TEXT.edit);
        expect(rowButton(radius, TEXT.remove)).toBeDefined();
        const other = row(wrapper, 'other');
        expect(other.text()).not.toContain(TEXT.canRead);
        expect(other.text()).toContain('darf nichts');
        expect(other.text()).toContain('1 Schlüssel');
        // A creator ChurchTools doesn't show (gone, or not visible): only the id.
        expect(other.text()).toContain('angelegt am 2026-11-01 von Person mit ID 77');
        expect(wrapper.text()).toContain(TEXT.creatorNote);
    });

    it('an empty list says what to do next; „+ Client hinzufügen“ opens the form', async () => {
        const { wrapper, router } = await open({ path: '/settings/access' });
        expect(wrapper.find('.cps-access__clients-empty').text()).toBe(TEXT.empty);
        const add = button(wrapper, TEXT.add)!;
        expect(add.classes()).toContain('cps-btn--create');
        await click(wrapper, TEXT.add);
        expect(router.currentRoute.value.path).toBe('/settings/access/clients/new');
    });

    it('removing a client asks („Wirkt innerhalb von 5 Minuten.“) as a dangerous step; cancelling writes nothing', async () => {
        const { wrapper, writes } = await open({ path: '/settings/access', access: access([client('wlan-radius', 'WLAN RADIUS', [key(1)])]) });
        rowButton(row(wrapper, 'wlan-radius'), TEXT.remove)!.element.click();
        await settle();
        const d = dialog()!;
        expect(d.querySelector('.cps-confirm__title')?.textContent).toBe(TEXT.removeTitle);
        expect(d.querySelector('.cps-confirm__subject-name')?.textContent).toBe('WLAN RADIUS');
        expect(d.querySelector('.cps-confirm__subject-detail')?.textContent).toBe('wlan-radius');
        expect(d.querySelector('.cps-confirm__text')?.textContent).toContain(TEXT.within5);
        expect(d.querySelector('[data-confirm]')?.classList.contains('cps-btn--danger')).toBe(true);
        await answer(TEXT.cancel);
        expect(writes).toEqual([]);
        expect(row(wrapper, 'wlan-radius').exists()).toBe(true);
    });

    it('confirming removes exactly that client, raises the revision and keeps the rest', async () => {
        const { wrapper, storedAccess } = await open({
            path: '/settings/access',
            access: access([client('one', 'Eins', [key(1)], { note: 'kept' }), client('two', 'Zwei', [key(2)])]),
        });
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        const stored = await storedAccess();
        expect(stored.revision).toBe(2);
        expect(stored.machineClients).toEqual([client('two', 'Zwei', [key(2)])]);
        expect(stored.groups).toEqual(ACCESS.groups);
        expect(row(wrapper, 'one').exists()).toBe(false);
        expect(wrapper.find('.cps-access__done').text()).toContain(TEXT.within5);
    });

    it('leaving the page while the question is open: confirming afterwards sends nothing', async () => {
        const { wrapper, writes, router } = await open({ path: '/settings/access', access: access([client('one', 'Eins', [key(1)]), { id: 'noname', publicKeys: [key(5)], createdAt: '2026-11-01' }]) });
        for (const target of [() => rowButton(row(wrapper, 'one'), TEXT.remove)!, () => rowButton(broken(wrapper)[0]!, TEXT.remove)!]) {
            target().element.click();
            await settle();
            await router.push('/settings');
            await settle();
            await answer(TEXT.remove);
            expect(writes).toEqual([]);
            await router.push('/settings/access');
            await settle();
        }
    });

    it('asks only once at a time: a second click while the question is open opens no second one', async () => {
        const { wrapper, writes } = await open({ path: '/settings/access', access: access([client('one', 'Eins', [key(1)]), client('two', 'Zwei', [key(2)])]) });
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        expect(rowButton(row(wrapper, 'two'), TEXT.remove)!.element.disabled).toBe(true);
        rowButton(row(wrapper, 'two'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.cancel);
        expect(dialog()).toBeNull();
        expect(writes).toEqual([]);
    });

    it('a change elsewhere meanwhile: reports the conflict, writes nothing', async () => {
        const { wrapper, writes, changeAccessElsewhere } = await open({ path: '/settings/access', access: access([client('one', 'Eins', [key(1)])]) });
        await changeAccessElsewhere({});
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(writes).toEqual([]);
        expect(wrapper.find('.cps-access__error').text()).toContain(TEXT.conflict);
    });

    it('names, ids and group names are plain text, never markup or message syntax', async () => {
        const odd = '{x} @:app.name | <b>y</b>';
        const { wrapper } = await open({
            path: '/settings/access',
            groups: [{ ...GROUPS[0]!, name: odd }, GROUPS[1]!],
            access: access([client('odd', odd, [key(1)])]),
        });
        expect(group(wrapper, 'users').find('.cps-access__group-name').text()).toBe(odd);
        expect(row(wrapper, 'odd').find('.cps-access__client-name').text()).toBe(odd);
        expect(wrapper.find('main b').exists()).toBe(false);
    });
});

describe('Zugriff: entries the backend can’t use („falsch konfiguriert“)', () => {
    const noName = { id: 'noname', publicKeys: [key(5)], permissions: ['entries:read'], createdAt: '2026-11-01' };
    const badDate = { id: 'bad-date', name: 'Datum', publicKeys: [key(6)], createdAt: '1.11.2026' };

    it('lists each with index, raw id and the reasons as plain text; not among the clients', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([client('good', 'Gut', [key(1)]), noName, 'text', badDate]) });
        expect(wrapper.find('.cps-access__broken').text()).toContain(TEXT.brokenTitle);
        const entries = broken(wrapper);
        expect(entries.map((e) => e.find('.cps-access__broken-name').text())).toEqual(['Eintrag 2: noname', 'Eintrag 3', 'Eintrag 4: bad-date']);
        expect(entries[0]!.text()).toContain('Der Name fehlt.');
        expect(entries[1]!.text()).toContain('Der Eintrag ist kein Objekt.');
        expect(entries[2]!.text()).toContain('Das Anlagedatum fehlt oder ist kein Datum wie 2026-11-01.');
        expect(row(wrapper, 'noname').exists()).toBe(false);
        expect(row(wrapper, 'good').exists()).toBe(true);
    });

    it('shows every reason of a duplicate id and of a shared key', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([client('dup', 'A', [key(1)]), client('dup', 'B', [key(2)]), client('xa1', 'X', [key(3)]), client('xa2', 'Y', [key(3)])]) });
        const texts = broken(wrapper).map((e) => e.text());
        expect(texts).toHaveLength(4);
        expect(texts[0]).toContain('Die ID kommt mehrmals vor.');
        expect(texts[1]).toContain('Die ID kommt mehrmals vor.');
        expect(texts[2]).toContain('Ein öffentlicher Schlüssel gehört auch einem anderen Client.');
        expect(texts[3]).toContain('Ein öffentlicher Schlüssel gehört auch einem anderen Client.');
    });

    it('removes one after a dangerous confirm; the others stay unchanged', async () => {
        const { wrapper, storedAccess } = await open({ path: '/settings/access', access: access([client('good', 'Gut', [key(1)]), noName, 'text']) });
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        const d = dialog()!;
        expect(d.querySelector('.cps-confirm__title')?.textContent).toBe(TEXT.brokenRemoveTitle);
        expect(d.querySelector('.cps-confirm__text')?.textContent).toContain(TEXT.within5);
        expect(d.querySelector('[data-confirm]')?.classList.contains('cps-btn--danger')).toBe(true);
        await answer(TEXT.remove);
        const stored = await storedAccess();
        expect(stored.machineClients).toEqual([client('good', 'Gut', [key(1)]), 'text']);
        expect(broken(wrapper).map((e) => e.find('.cps-access__broken-name').text())).toEqual(['Eintrag 2']);
    });

    it('a raw id is shown isolated (bidi) and cut, as text', async () => {
        const long = `‮evil${'x'.repeat(100)}`;
        const { wrapper } = await open({ path: '/settings/access', access: access([{ ...noName, id: long }]) });
        const name = broken(wrapper)[0]!.find('.cps-access__broken-name');
        expect(name.find('bdi').exists()).toBe(true);
        expect(name.text().length).toBeLessThan(70);
    });

    it('a stored list the store can’t use as a whole (invalid groups): still lists the entries, offers no removal', async () => {
        const { wrapper, router, replaceAccess } = await open({ path: '/settings' });
        await replaceAccess({ ...ACCESS, groups: 'broken', machineClients: [client('good', 'Gut', [key(1)]), noName] });
        await router.push('/settings/access');
        await settle();
        expect(wrapper.find('.cps-access__invalid').text()).toContain('Die gespeicherten Zugriffsdaten sind ungültig');
        expect(broken(wrapper).map((e) => e.find('.cps-access__broken-name').text())).toEqual(['Eintrag 2: noname']);
        expect(rowButton(broken(wrapper)[0]!, TEXT.remove)).toBeUndefined();
        expect(wrapper.find('[data-role]').exists()).toBe(false);
        expect(button(wrapper, TEXT.add)).toBeUndefined();
    });

    it('a stale entry (changed elsewhere, revision raised) is not dropped: conflict, nothing written', async () => {
        const { wrapper, writes, changeAccessElsewhere } = await open({ path: '/settings/access', access: access([noName]) });
        await changeAccessElsewhere({ machineClients: [{ ...noName, id: 'other' }] });
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(writes).toEqual([]);
        expect(wrapper.find('.cps-access__error').text()).toContain(TEXT.conflict);
    });
});
