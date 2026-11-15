/**
 * App layer (mounted): „Zugriff“ (spec 4.7): the warning, the users and admins groups, the machine clients with
 * removal, and the stored entries the backend can't use („falsch konfiguriert“, USER DECISION 2026-11-14).
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS, ME, ORIGIN, answer, button, cleanup, click, dialog, settle, start } from './settings-harness';
import { keyFingerprint } from '../../admin/machine-clients';
import { CtForbiddenError, CtHttpError } from '../../ct/errors';
import { InvalidValueError } from '../../model/errors';

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
    stillActive: 'Das Backend verwendet die aktiven Clients unten trotzdem. Entfernen kannst du sie auch jetzt.',
    brokenIntro: 'Diese Einträge kann das Backend nicht verwenden; es schaltet sie ab. Entferne sie und leg den Client bei Bedarf neu an.',
    noRemove: 'Solange die Zugriffsdaten keine gültige Revision haben, lässt sich hier nichts entfernen.',
    notSaved: 'Der Zugriff wurde nicht gespeichert: Ein Wert ist ungültig oder kollidiert mit einem falsch konfigurierten Eintrag. Prüf die Liste unter „Zugriff“.',
    retry: 'Erneut versuchen',
    reload: 'Neu laden',
    removed: '✓ Entfernt. Wirkt innerhalb von 5 Minuten.',
    dupHint: 'Diese ID kommt mehrmals vor. Ist keiner dieser Einträge gewollt, entferne alle mit dieser ID.',
    setupFix: 'Hier lassen sie sich nicht reparieren. Reparieren lässt sich das mit dem Einrichtungsassistenten, sobald es ihn gibt.',
    askFix: 'Hier lassen sie sich nicht reparieren. Wende dich an jemanden, der die Einrichtung ausführen darf.',
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

    it('a deleted group shows the error with the fix (setup-capable: with the setup assistant)', async () => {
        const { wrapper } = await open({ path: '/settings/access', groups: GROUPS.filter((g) => g.id !== 41), setupCapable: true });
        const admins = group(wrapper, 'admins');
        const error = admins.find('.cps-access__group-error');
        expect(error.attributes('role')).toBe('alert');
        expect(error.text()).toContain('Die Gruppe mit der ID 41 gibt es in ChurchTools nicht mehr.');
        expect(error.text()).toContain('Eine andere Gruppe ordnest du mit dem Einrichtungsassistenten zu, sobald es ihn gibt.');
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
        // The name isolated (U+2068 … U+2069), so bidi characters in it can't reorder the dialog.
        expect(d.querySelector('.cps-confirm__subject-name')?.textContent).toBe('\u2068WLAN RADIUS\u2069');
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
        expect(name.find('bdi').text()).toBe(`${long.slice(0, 40)}…`);
    });

    it('an access value invalid here but used by the backend (F1): lists active and broken clients, removes one changing nothing else', async () => {
        const { wrapper, router, replaceAccess, storedAccess } = await open({ path: '/settings' });
        const value = { ...ACCESS, groups: { ...ACCESS.groups, service: { groupId: 42, createdBySetup: 'x' } }, machineClients: [client('reader', 'Leser', [key(1)]), noName], extra: { a: [1] } };
        await replaceAccess(value);
        await router.push('/settings/access');
        await settle();
        expect(wrapper.find('.cps-access__invalid').text()).toContain('Die gespeicherten Zugriffsdaten sind ungültig');
        expect(wrapper.find('.cps-access__invalid').text()).toContain(TEXT.stillActive);
        const reader = row(wrapper, 'reader');
        expect(reader.find('.cps-access__client-name').text()).toBe('Leser');
        expect(reader.text()).toContain(TEXT.canRead);
        expect(reader.find('a').exists()).toBe(false);
        expect(broken(wrapper).map((e) => e.find('.cps-access__broken-name').text())).toEqual(['Eintrag 2: noname']);
        expect(wrapper.find('[data-role]').exists()).toBe(false);
        expect(button(wrapper, TEXT.add)).toBeUndefined();
        rowButton(reader, TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(await storedAccess()).toEqual({ ...value, machineClients: [noName], revision: 2 });
        expect(row(wrapper, 'reader').exists()).toBe(false);
    });

    it.each([[-1], [2 ** 53]])('an invalid value with a revision out of range (%s): lists everything, removes nothing', async (revision) => {
        const { wrapper, router, replaceAccess } = await open({ path: '/settings' });
        await replaceAccess({ ...ACCESS, revision, machineClients: [client('reader', 'Leser', [key(1)]), noName] });
        await router.push('/settings/access');
        await settle();
        expect(row(wrapper, 'reader').exists()).toBe(true);
        expect(rowButton(row(wrapper, 'reader'), TEXT.remove)).toBeUndefined();
        expect(rowButton(broken(wrapper)[0]!, TEXT.remove)).toBeUndefined();
        expect(wrapper.find('.cps-access__invalid').text()).toContain(TEXT.noRemove);
        expect(wrapper.find('.cps-access__invalid').text()).not.toContain(TEXT.stillActive);
        expect(wrapper.find('.cps-access__broken').text()).toContain(TEXT.noRemove);
        expect(wrapper.find('.cps-access__broken').text()).not.toContain(TEXT.brokenIntro);
    });

    it('a planted reader in a value with a revision that is no integer (S-N1): removable, everything else unchanged', async () => {
        const { wrapper, router, replaceAccess, storedAccess } = await open({ path: '/settings' });
        const value = { ...ACCESS, revision: 'x', groups: 'broken', machineClients: [client('reader', 'Leser', [key(1)])] };
        await replaceAccess(value);
        await router.push('/settings/access');
        await settle();
        expect(wrapper.find('.cps-access__invalid').text()).toContain(TEXT.stillActive);
        rowButton(row(wrapper, 'reader'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(await storedAccess()).toEqual({ ...value, machineClients: [], revision: 1 });
    });

    it('an invalid value: the creator of an active client is named, isolated (M-d)', async () => {
        const { wrapper, router, replaceAccess } = await open({ path: '/settings' });
        await replaceAccess({ ...ACCESS, groups: 'broken', machineClients: [client('reader', 'Leser', [key(1)], { createdBy: ME })] });
        await router.push('/settings/access');
        await settle();
        const created = row(wrapper, 'reader').find('.cps-access__created');
        expect(created.text()).toBe('angelegt am 2026-11-01 von Anna Admin');
        expect(created.find('bdi').text()).toBe('Anna Admin');
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

const fp = (n: number) => keyFingerprint(new Uint8Array(32).fill(n));
const noNameEntry = { id: 'noname', publicKeys: [key(5)], permissions: ['entries:read'], createdAt: '2026-11-01' };

describe('Zugriff: removing the right entry (I1, I8, F2)', () => {
    it('removing the second of three removes exactly that one', async () => {
        const one = client('one', 'Eins', [key(1)]);
        const three = client('three', 'Drei', [key(3)]);
        const { wrapper, storedAccess } = await open({ path: '/settings/access', access: access([one, client('two', 'Zwei', [key(2)]), three]) });
        rowButton(row(wrapper, 'two'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect((await storedAccess()).machineClients).toEqual([one, three]);
    });

    it('removes a broken entry without an id (by index and the entry as read)', async () => {
        const { wrapper, storedAccess } = await open({ path: '/settings/access', access: access(['text', noNameEntry]) });
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect((await storedAccess()).machineClients).toEqual([noNameEntry]);
    });

    it('the question for a broken entry names „Eintrag N“ and its raw id (cut to 40, isolated); none without an id', async () => {
        const long = `${'y'.repeat(50)}`;
        const { wrapper } = await open({ path: '/settings/access', access: access(['text', { ...noNameEntry, id: long }]) });
        rowButton(broken(wrapper)[1]!, TEXT.remove)!.element.click();
        await settle();
        expect(dialog()!.querySelector('.cps-confirm__subject-name')?.textContent).toBe('Eintrag 2');
        expect(dialog()!.querySelector('.cps-confirm__subject-detail')?.textContent).toBe(`\u2068${'y'.repeat(40)}…\u2069`);
        await answer(TEXT.cancel);
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        expect(dialog()!.querySelector('.cps-confirm__subject-name')?.textContent).toBe('Eintrag 1');
        expect(dialog()!.querySelector('.cps-confirm__subject-detail')).toBeNull();
        await answer(TEXT.cancel);
    });

    it('every row shows a fingerprint per key and names in <bdi>, for active and broken entries (F2a)', async () => {
        const { wrapper } = await open({
            path: '/settings/access',
            access: access([client('one', 'Ei\u202Ens', [key(1), key(2)]), { ...client('dup', 'Look', [key(3), 'nope']), id: 'dup' }, client('dup', 'Alike', [key(4)])]),
        });
        const one = row(wrapper, 'one');
        expect(one.find('bdi.cps-access__client-name').text()).toBe('Ei\u202Ens');
        expect(one.findAll('.cps-access__fingerprints code').map((c) => c.text())).toEqual([fp(1), fp(2)]);
        const entries = broken(wrapper);
        expect(entries[0]!.find('bdi.cps-access__broken-label').text()).toBe('Look');
        expect(entries[0]!.findAll('.cps-access__fingerprints code').map((c) => c.text())).toEqual([fp(3), 'ungültig']);
        expect(entries[1]!.findAll('.cps-access__fingerprints code').map((c) => c.text())).toEqual([fp(4)]);
        expect(entries[1]!.text()).toContain(TEXT.canRead);
        expect(entries[1]!.text()).toContain('angelegt am 2026-11-01');
    });

    it('removing one of two entries with the same id names the other, which it would turn on, and suggests removing both (F2b)', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([client('dup', 'Echt', [key(1)]), client('dup', 'Planted', [key(2)])]) });
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        const text = dialog()!.querySelector('.cps-confirm__text')?.textContent ?? '';
        expect(text).toContain(TEXT.dupHint);
        expect(text).toContain(`Danach schaltet das Backend frei: „\u2068Planted\u2069“ (ID \u2068dup\u2069, darf lesen, Schlüssel ${fp(2)}).`);
        await answer(TEXT.cancel);
    });

    it('removing one of two clients sharing a key names the other; removing an unrelated one names nobody', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([client('aaa', 'A', [key(1)]), client('bbb', 'B', [key(1)]), client('ccc', 'C', [key(3)])]) });
        rowButton(broken(wrapper)[1]!, TEXT.remove)!.element.click();
        await settle();
        let text = dialog()!.querySelector('.cps-confirm__text')?.textContent ?? '';
        expect(text).toContain('„\u2068A\u2069“ (ID \u2068aaa\u2069');
        expect(text).not.toContain(TEXT.dupHint);
        await answer(TEXT.cancel);
        rowButton(row(wrapper, 'ccc'), TEXT.remove)!.element.click();
        await settle();
        text = dialog()!.querySelector('.cps-confirm__text')?.textContent ?? '';
        expect(text).not.toContain('Danach schaltet');
        await answer(TEXT.cancel);
    });
});

describe('Zugriff: page states and outcomes (I6, I7)', () => {
    it('a failed read shows the error with a retry that reads again', async () => {
        const { wrapper, router, store } = await open({ path: '/settings' });
        const real = store.readAccess.bind(store);
        vi.spyOn(store, 'readAccess').mockRejectedValueOnce(new CtHttpError(500)).mockImplementation(real);
        await router.push('/settings/access');
        await settle();
        expect(wrapper.find('.cps-status--error').text()).toBe('ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.');
        await click(wrapper, TEXT.retry);
        expect(wrapper.find('.cps-status--error').exists()).toBe(false);
        expect(group(wrapper, 'users').exists()).toBe(true);
    });

    it('a 403 on the read names the right on access', async () => {
        const { wrapper, router, store } = await open({ path: '/settings' });
        vi.spyOn(store, 'readAccess').mockRejectedValue(new CtForbiddenError('x', 'view custom data'));
        await router.push('/settings/access');
        await settle();
        expect(wrapper.find('.cps-status--error').text()).toBe('Dir fehlt in ChurchTools das Recht „view custom data“ auf die Kategorie „access“.');
    });

    it.each([
        ['missing', { state: 'missing' }, 'Es sind noch keine Zugriffsdaten gespeichert. Die Erweiterung muss zuerst eingerichtet werden.'],
        ['newer', { state: 'newer', schema: 3 }, 'Die gespeicherten Zugriffsdaten stammen von einer neueren Version. Bitte aktualisiere die Erweiterung.'],
    ])('%s: says so, shows nothing else', async (_n, result, text) => {
        const { wrapper, router, store } = await open({ path: '/settings' });
        vi.spyOn(store, 'readAccess').mockResolvedValue(result as never);
        await router.push('/settings/access');
        await settle();
        expect(wrapper.find('.cps-status--empty').text()).toBe(text);
        expect(wrapper.find('[data-role]').exists()).toBe(false);
    });

    it('a removal that fails otherwise than by a conflict shows the reason, no „Entfernt“', async () => {
        const { wrapper, store } = await open({ path: '/settings/access', access: access([client('one', 'Eins', [key(1)])]) });
        vi.spyOn(store, 'removeClients').mockRejectedValue(new InvalidValueError(['x']));
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(wrapper.find('.cps-access__error').text()).toBe(TEXT.notSaved);
        expect(wrapper.find('.cps-access__done').exists()).toBe(false);
    });

    it.each([
        [true, 'setupFix'],
        [false, 'askFix'],
    ] as const)('an invalid value lists its issues and the fix (setup-capable: %s)', async (setupCapable, fix) => {
        const { wrapper, router, replaceAccess } = await open({ path: '/settings', setupCapable });
        await replaceAccess({ ...ACCESS, groups: 'broken' });
        await router.push('/settings/access');
        await settle();
        const banner = wrapper.find('.cps-access__invalid');
        expect(banner.findAll('li').map((li) => li.text())).toEqual([expect.stringContaining('groups')]);
        expect(banner.text()).toContain(TEXT[fix]);
    });

    it('a conflict, then „Neu laden“, then a removal: „Entfernt“ and no conflict any more', async () => {
        const { wrapper, changeAccessElsewhere, storedAccess } = await open({ path: '/settings/access', access: access([client('one', 'Eins', [key(1)])]) });
        await changeAccessElsewhere({});
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(wrapper.find('.cps-access__error').text()).toContain(TEXT.conflict);
        await click(wrapper, TEXT.reload);
        expect(wrapper.find('.cps-access__error').exists()).toBe(false);
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(wrapper.find('.cps-access__done').text()).toBe(TEXT.removed);
        expect(wrapper.find('.cps-access__error').exists()).toBe(false);
        expect((await storedAccess()).machineClients).toEqual([]);
    });

    it('unknown permissions dropped from a client are listed (they go with the next save), entry issues are not repeated', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([client('star', 'Stern', [key(1)], { permissions: ['entries:read', '*'] }), noNameEntry]) });
        const banner = wrapper.find('.cps-access__dropped');
        expect(banner.findAll('li').map((li) => li.text())).toEqual(['machineClients.0.permissions: unknown permission dropped']);
        expect(banner.text()).toContain('Beim nächsten Speichern wird er entfernt.');
    });

    it('a removal leaves unknown permissions of other clients as stored', async () => {
        const star = client('star', 'Stern', [key(1)], { permissions: ['entries:read', '*'] });
        const { wrapper, storedAccess } = await open({ path: '/settings/access', access: access([star, client('two', 'Zwei', [key(2)])]) });
        rowButton(row(wrapper, 'two'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect((await storedAccess()).machineClients).toEqual([star]);
    });
});

describe('Zugriff: guards and details (minors)', () => {
    it('a removal confirmed after the value changed elsewhere (revision raised) is refused by the store: nothing sent', async () => {
        const { wrapper, writes, changeAccessElsewhere } = await open({ path: '/settings/access', access: access([client('one', 'Eins', [key(1)])]) });
        await changeAccessElsewhere({});
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        button(wrapper, TEXT.reload)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(writes).toEqual([]);
    });

    it('broken entries’ buttons are disabled while a question is open', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([noNameEntry, 'text']) });
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        expect(rowButton(broken(wrapper)[1]!, TEXT.remove)!.element.disabled).toBe(true);
        await answer(TEXT.cancel);
    });

    it('a group answer of an older read arriving last changes nothing', async () => {
        const held: ((g: { id: number; name: string; memberCount: number }) => void)[] = [];
        const { wrapper, router, ct, changeAccessElsewhere } = await open({ path: '/settings', access: access([client('one', 'Eins', [key(1)])]) });
        const real = ct.group.bind(ct);
        vi.spyOn(ct, 'group')
            .mockImplementationOnce(() => new Promise((resolve) => held.push(resolve)))
            .mockImplementationOnce(() => new Promise((resolve) => held.push(resolve)))
            .mockImplementation(real);
        await router.push('/settings/access');
        await settle();
        expect(group(wrapper, 'users').find('.cps-access__group-loading').text()).toBe('Lade …');
        await changeAccessElsewhere({});
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        await click(wrapper, TEXT.reload);
        expect(group(wrapper, 'users').find('.cps-access__group-name').text()).toBe('CtPassStore Nutzer');
        for (const resolve of held) resolve({ id: 40, name: 'STALE', memberCount: 0 });
        await settle();
        expect(group(wrapper, 'users').find('.cps-access__group-name').text()).toBe('CtPassStore Nutzer');
        expect(group(wrapper, 'admins').find('.cps-access__group-name').text()).toBe('CtPassStore Admins');
    });

    it.each([['x'], [0], [-1], [1.5], [{}]])('an invalid createdBy (%j) shows no creator and reads no person', async (createdBy) => {
        const { wrapper, router, ct } = await open({ path: '/settings', access: access([client('one', 'Eins', [key(1)], { createdBy })]) });
        const person = vi.spyOn(ct, 'person');
        await router.push('/settings/access');
        await settle();
        expect(row(wrapper, 'one').find('.cps-access__created').text()).toBe('angelegt am 2026-11-01');
        expect(person).not.toHaveBeenCalled();
    });

    it('a creator ChurchTools shows without a name is listed by id', async () => {
        const { wrapper } = await open({ path: '/settings/access', persons: [...PERSONS, { id: 8, firstName: '', lastName: '' }], groups: [...GROUPS, { id: 50, name: 'G', memberIds: [ME, 8] }], access: access([client('one', 'Eins', [key(1)], { createdBy: 8 })]) });
        expect(row(wrapper, 'one').find('.cps-access__created').text()).toBe('angelegt am 2026-11-01 von Person mit ID 8');
    });

    it.each([
        ['not-an-object', 'text', 'Der Eintrag ist kein Objekt.'],
        ['invalid-id', { ...noNameEntry, name: 'n', id: 'AB' }, 'Die ID muss 3 bis 40 Zeichen a–z, 0–9 oder - haben.'],
        ['missing-name', noNameEntry, 'Der Name fehlt.'],
        ['invalid-created-at', { ...noNameEntry, name: 'n', createdAt: 'x' }, 'Das Anlagedatum fehlt oder ist kein Datum wie 2026-11-01.'],
        ['no-keys', { ...noNameEntry, name: 'n', publicKeys: [] }, 'Es ist kein öffentlicher Schlüssel eingetragen.'],
        ['invalid-key', { ...noNameEntry, name: 'n', publicKeys: ['nope'] }, 'Ein öffentlicher Schlüssel ist ungültig.'],
        ['invalid-permissions', { ...noNameEntry, name: 'n', permissions: 'x' }, 'Die Berechtigungen sind keine Liste.'],
    ])('reason %s in words', async (_reason, entry, text) => {
        const { wrapper } = await open({ path: '/settings/access', access: access([entry]) });
        expect(broken(wrapper)[0]!.find('.cps-access__reasons').text()).toBe(text);
    });

    it('reasons duplicate-id and shared-key in words', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([client('dup', 'A', [key(1)]), client('dup', 'B', [key(2)]), client('kk1', 'C', [key(3)]), client('kk2', 'D', [key(3)])]) });
        const reasons = broken(wrapper).map((e) => e.find('.cps-access__reasons').text());
        expect(reasons).toEqual(['Die ID kommt mehrmals vor.', 'Die ID kommt mehrmals vor.', 'Ein öffentlicher Schlüssel gehört auch einem anderen Client.', 'Ein öffentlicher Schlüssel gehört auch einem anderen Client.']);
    });

    it('no status dot on the groups until the rights check exists (spec 4.7, 12.6)', async () => {
        const { wrapper } = await open({ path: '/settings/access' });
        for (const role of ['users', 'admins'] as const) expect(group(wrapper, role).find('.cps-pill').exists()).toBe(false);
    });
});

describe('Zugriff: round 2', () => {
    it('a removal sends the entry as read: swapped look-alikes (same id, revision unchanged) are refused (N1)', async () => {
        const echt = client('dup', 'Echt', [key(1)]);
        const planted = client('dup', 'Planted', [key(2)]);
        const { wrapper, writes, replaceAccess, storedAccess } = await open({ path: '/settings/access', access: access([echt, planted]) });
        await replaceAccess(access([planted, echt]));
        rowButton(broken(wrapper)[1]!, TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        expect(writes).toEqual([]);
        expect(wrapper.find('.cps-access__error').text()).toContain(TEXT.conflict);
        expect((await storedAccess()).machineClients).toEqual([planted, echt]);
    });

    it('an entry with only unknown permissions reads as „darf nichts“, in the row and in the question (N2)', async () => {
        const { wrapper } = await open({ path: '/settings/access', access: access([client('dup', 'Echt', [key(1)]), client('dup', 'Stern', [key(2)], { permissions: ['*'] })]) });
        expect(broken(wrapper)[1]!.text()).toContain('darf nichts');
        expect(broken(wrapper)[1]!.text()).not.toContain(TEXT.canRead);
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        expect(dialog()!.querySelector('.cps-confirm__text')?.textContent).toContain(`„\u2068Stern\u2069“ (ID \u2068dup\u2069, darf nichts, Schlüssel ${fp(2)})`);
        await answer(TEXT.cancel);
    });

    it('the „schaltet frei“ list cuts names and ids to 40 (T2)', async () => {
        const longId = `a${'b'.repeat(39)}`;
        const longName = 'N'.repeat(55);
        const { wrapper } = await open({ path: '/settings/access', access: access([client(longId, 'Echt', [key(1)]), client(longId, longName, [key(2)])]) });
        rowButton(broken(wrapper)[0]!, TEXT.remove)!.element.click();
        await settle();
        const text = dialog()!.querySelector('.cps-confirm__text')?.textContent ?? '';
        expect(text).toContain(`„\u2068${'N'.repeat(40)}…\u2069“ (ID \u2068${longId}\u2069`);
        await answer(TEXT.cancel);
    });

    it('a broken entry: a 5000-character name and a createdAt with U+202E are cut and isolated; a real date is plain (S-N3)', async () => {
        const odd = { id: 'odd', name: 'n'.repeat(5000), publicKeys: [], createdAt: `2026\u202E${'x'.repeat(100)}` };
        const { wrapper } = await open({ path: '/settings/access', access: access([odd, noNameEntry]) });
        const first = broken(wrapper)[0]!;
        expect(first.find('bdi.cps-access__broken-label').text()).toBe(`${'n'.repeat(60)}…`);
        const created = first.find('.cps-access__created');
        expect(created.find('bdi').text()).toBe(`2026\u202E${'x'.repeat(55)}…`);
        expect(created.text()).toBe(`angelegt am 2026\u202E${'x'.repeat(55)}…`);
        expect(broken(wrapper)[1]!.find('.cps-access__created').text()).toBe('angelegt am 2026-11-01');
        expect(broken(wrapper)[1]!.find('.cps-access__created bdi').exists()).toBe(false);
    });

    it('a creator answer of an older read arriving last changes nothing (M-d)', async () => {
        const held: ((p: { id: number; name: string }) => void)[] = [];
        const { wrapper, router, ct, changeAccessElsewhere } = await open({ path: '/settings', access: access([client('one', 'Eins', [key(1)], { createdBy: ME })]) });
        const real = ct.person.bind(ct);
        vi.spyOn(ct, 'person')
            .mockImplementationOnce(() => new Promise((resolve) => held.push(resolve)))
            .mockImplementation(real);
        await router.push('/settings/access');
        await settle();
        await changeAccessElsewhere({});
        rowButton(row(wrapper, 'one'), TEXT.remove)!.element.click();
        await settle();
        await answer(TEXT.remove);
        await click(wrapper, TEXT.reload);
        expect(row(wrapper, 'one').find('.cps-access__created').text()).toBe('angelegt am 2026-11-01 von Anna Admin');
        for (const resolve of held) resolve({ id: ME, name: 'STALE' });
        await settle();
        expect(row(wrapper, 'one').find('.cps-access__created').text()).toBe('angelegt am 2026-11-01 von Anna Admin');
    });
});
