/**
 * App layer (mounted): the machine client form (spec 4.7): name, an ID proposed from the name and fixed after creation,
 * public keys checked on the spot with the backend's rules (backend spec 3.2), the permission, and the saving rules of
 * every settings page (spec 4.4).
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { todayIso } from '../../admin/machine-clients';
import { ACCESS, ME, button, cleanup, click, settle, start } from './settings-harness';

afterEach(cleanup);

const TEXT = {
    missingRight: 'Dir fehlt in ChurchTools das Recht „edit custom data“ auf die Kategorie „access“.',
    save: 'Speichern',
    keyInvalid: 'Das ist kein gültiger Schlüssel: Er muss als base64 oder base64url genau 32 Bytes ergeben.',
    keyTaken: 'Diesen Schlüssel verwendet schon ein anderer Client. Jeder Client braucht ein eigenes Schlüsselpaar.',
    keyTwice: 'Diesen Schlüssel hast du schon eingetragen.',
    idTaken: 'Diese ID hat schon ein anderer Client.',
    idError: '3 bis 40 Zeichen: a–z, 0–9 und -.',
    idFixed: 'Die ID lässt sich nach dem Anlegen nicht ändern.',
    permission: 'Passwörter lesen',
    addKey: '+ Weiterer Schlüssel',
    notFound: 'Diesen Client gibt es nicht (mehr).',
    conflict: 'Jemand hat die Einstellungen inzwischen geändert. Lade neu, um die Änderungen zu sehen.',
    notSaved: 'Der Zugriff wurde nicht gespeichert: Ein Wert ist ungültig oder kollidiert mit einem falsch konfigurierten Eintrag. Prüf die Liste unter „Zugriff“.',
    issuesNote: 'Falsch konfigurierte Einträge bleiben beim Speichern erhalten; entfernen kannst du sie unter „Zugriff“.',
};

const key = (n: number, length = 32) => Buffer.alloc(length, n).toString('base64');
const client = (id: string, name: string, keys: string[], extra: Record<string, unknown> = {}) => ({ id, name, publicKeys: keys, permissions: ['entries:read'], createdAt: '2026-11-01', ...extra });
const access = (machineClients: unknown[]) => ({ ...ACCESS, machineClients });

const input = (w: VueWrapper, id: string) => w.find<HTMLInputElement>(`#${id}`);
const errorOf = (w: VueWrapper, id: string) => {
    const describedby = input(w, id).attributes('aria-describedby') ?? '';
    return describedby
        .split(' ')
        .filter(Boolean)
        .map((x) => w.find(`#${x}`))
        .filter((x) => x.exists() && x.classes().includes('cps-field__error'))
        .map((x) => x.text())
        .join(' ');
};
async function type(w: VueWrapper, id: string, value: string) {
    await input(w, id).setValue(value);
    await settle();
}
const saveDisabled = (w: VueWrapper) => button(w, TEXT.save)!.element.disabled;
const permissionToggle = (w: VueWrapper) => {
    const t = w.findAll('.cps-toggle').find((x) => x.find('.cps-toggle__label').text() === TEXT.permission);
    if (!t) throw new Error('no permission toggle');
    return t.find<HTMLButtonElement>('button[role="switch"]');
};

describe('client form (spec 4.7)', () => {
    it('without edit custom data on access: names the right, reads nothing', async () => {
        const { wrapper, storeReads, router } = await start({ path: '/settings', edit: ['settings'] });
        const before = storeReads.access;
        await router.push('/settings/access/clients/new');
        await settle();
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(TEXT.missingRight);
        expect(storeReads.access).toBe(before);
        expect(input(wrapper, 'cps-client-name').exists()).toBe(false);
    });

    it('a new client: the ID follows the name until it is typed itself; nothing changed means nothing to save', async () => {
        const { wrapper } = await start({ path: '/settings/access/clients/new' });
        expect(saveDisabled(wrapper)).toBe(true);
        await type(wrapper, 'cps-client-name', 'WLAN RADIUS');
        expect(input(wrapper, 'cps-client-id').element.value).toBe('wlan-radius');
        await type(wrapper, 'cps-client-name', 'Ü');
        expect(input(wrapper, 'cps-client-id').element.value).toBe('');
        await type(wrapper, 'cps-client-id', 'my-own');
        await type(wrapper, 'cps-client-name', 'Something else');
        expect(input(wrapper, 'cps-client-id').element.value).toBe('my-own');
    });

    it('checks the ID on the spot: pattern and taken (by a client, or by an entry the backend can’t use)', async () => {
        const noName = { id: 'broken-one', publicKeys: [key(9)], createdAt: '2026-11-01' };
        const { wrapper } = await start({ path: '/settings/access/clients/new', access: access([client('taken', 'T', [key(1)]), noName]) });
        await type(wrapper, 'cps-client-name', 'Neu');
        await type(wrapper, 'cps-client-id', 'AB');
        expect(errorOf(wrapper, 'cps-client-id')).toBe(TEXT.idError);
        await type(wrapper, 'cps-client-id', 'taken');
        expect(errorOf(wrapper, 'cps-client-id')).toBe(TEXT.idTaken);
        await type(wrapper, 'cps-client-id', 'broken-one');
        expect(errorOf(wrapper, 'cps-client-id')).toBe(TEXT.idTaken);
        await type(wrapper, 'cps-client-id', 'free');
        expect(errorOf(wrapper, 'cps-client-id')).toBe('');
    });

    it('checks each key on the spot: 31 and 33 bytes rejected, a key of another client rejected, twice in one client rejected', async () => {
        const { wrapper } = await start({ path: '/settings/access/clients/new', access: access([client('other', 'Anderer', [key(1)])]) });
        await type(wrapper, 'cps-client-name', 'Neu');
        await type(wrapper, 'cps-client-key-0', key(2, 31));
        expect(errorOf(wrapper, 'cps-client-key-0')).toBe(TEXT.keyInvalid);
        expect(saveDisabled(wrapper)).toBe(true);
        await type(wrapper, 'cps-client-key-0', key(2, 33));
        expect(errorOf(wrapper, 'cps-client-key-0')).toBe(TEXT.keyInvalid);
        // The same 32 bytes as the other client's key, written as base64url.
        await type(wrapper, 'cps-client-key-0', Buffer.alloc(32, 1).toString('base64url'));
        expect(errorOf(wrapper, 'cps-client-key-0')).toBe(TEXT.keyTaken);
        expect(saveDisabled(wrapper)).toBe(true);
        await type(wrapper, 'cps-client-key-0', key(2));
        expect(errorOf(wrapper, 'cps-client-key-0')).toBe('');
        await click(wrapper, TEXT.addKey);
        await type(wrapper, 'cps-client-key-1', key(2));
        expect(errorOf(wrapper, 'cps-client-key-1')).toBe(TEXT.keyTwice);
        expect(saveDisabled(wrapper)).toBe(true);
        await type(wrapper, 'cps-client-key-1', key(3));
        expect(saveDisabled(wrapper)).toBe(false);
    });

    it('saves a new client with createdAt (today, local) and createdBy (whoami), trimmed key and name; back to „Zugriff“', async () => {
        const { wrapper, storedAccess, router } = await start({ path: '/settings/access/clients/new', access: access([client('other', 'Anderer', [key(1)])]) });
        await type(wrapper, 'cps-client-name', '  WLAN RADIUS ');
        await type(wrapper, 'cps-client-key-0', ` ${key(2)}\n`);
        permissionToggle(wrapper).element.click();
        await settle();
        await click(wrapper, TEXT.save);
        const stored = await storedAccess();
        expect(stored.revision).toBe(2);
        expect(stored.machineClients).toEqual([
            client('other', 'Anderer', [key(1)]),
            { id: 'wlan-radius', name: 'WLAN RADIUS', publicKeys: [key(2)], permissions: ['entries:read'], createdAt: todayIso(new Date()), createdBy: ME },
        ]);
        expect(router.currentRoute.value.path).toBe('/settings/access');
    });

    it('the permission is off for a new client until it is turned on', async () => {
        const { wrapper, storedAccess } = await start({ path: '/settings/access/clients/new' });
        expect(permissionToggle(wrapper).attributes('aria-checked')).toBe('false');
        await type(wrapper, 'cps-client-name', 'Nur Test');
        await type(wrapper, 'cps-client-key-0', key(2));
        await click(wrapper, TEXT.save);
        expect(((await storedAccess()).machineClients as { permissions: string[] }[])[0]!.permissions).toEqual([]);
    });

    it('editing: the ID can’t be changed after creation; other fields can; createdAt, createdBy and unknown fields stay', async () => {
        const stored0 = client('wlan-radius', 'WLAN RADIUS', [key(1)], { createdBy: 5, note: 'kept' });
        const { wrapper, storedAccess } = await start({ path: '/settings/access/clients/wlan-radius', access: access([stored0, client('two', 'Zwei', [key(2)])]) });
        const id = input(wrapper, 'cps-client-id');
        expect(id.element.value).toBe('wlan-radius');
        expect(id.element.readOnly).toBe(true);
        expect(wrapper.text()).toContain(TEXT.idFixed);
        await type(wrapper, 'cps-client-name', 'WLAN RADIUS neu');
        // Typing into the read-only field (or a script setting it) changes nothing that is saved.
        await type(wrapper, 'cps-client-id', 'renamed');
        await click(wrapper, TEXT.addKey);
        await type(wrapper, 'cps-client-key-1', key(3));
        await click(wrapper, TEXT.save);
        const clients = (await storedAccess()).machineClients as Record<string, unknown>[];
        expect(clients[0]).toEqual({ ...stored0, name: 'WLAN RADIUS neu', publicKeys: [key(1), key(3)] });
        expect(clients[1]).toEqual(client('two', 'Zwei', [key(2)]));
    });

    it('editing a client may keep its own key (not „used by another client“)', async () => {
        const { wrapper } = await start({ path: '/settings/access/clients/one', access: access([client('one', 'Eins', [key(1)])]) });
        expect(errorOf(wrapper, 'cps-client-key-0')).toBe('');
        await type(wrapper, 'cps-client-name', 'Eins neu');
        expect(saveDisabled(wrapper)).toBe(false);
    });

    it('an unknown or unusable client id: says so, offers nothing to save', async () => {
        const { wrapper } = await start({ path: '/settings/access/clients/nope', access: access([{ id: 'nope', publicKeys: [key(1)], createdAt: '2026-11-01' }]) });
        expect(wrapper.find('.cps-client__not-found').text()).toContain(TEXT.notFound);
        expect(wrapper.find('.cps-client__not-found a').attributes('href')).toBe('/settings/access');
        expect(input(wrapper, 'cps-client-name').exists()).toBe(false);
        expect(button(wrapper, TEXT.save)).toBeUndefined();
    });

    it('a change elsewhere meanwhile: conflict, nothing written', async () => {
        const { wrapper, writes, changeAccessElsewhere } = await start({ path: '/settings/access/clients/new' });
        await type(wrapper, 'cps-client-name', 'Neu');
        await type(wrapper, 'cps-client-key-0', key(2));
        await changeAccessElsewhere({});
        await click(wrapper, TEXT.save);
        expect(writes).toEqual([]);
        expect(wrapper.text()).toContain(TEXT.conflict);
    });

    it('a key of an entry the backend can’t use: the store refuses, the form says why', async () => {
        const hidden = { id: 'hidden', publicKeys: [key(7)], createdAt: '2026-11-01' };
        const { wrapper, writes } = await start({ path: '/settings/access/clients/new', access: access([hidden]) });
        expect(wrapper.find('.cps-settings-form__issues').text()).toContain(TEXT.issuesNote);
        await type(wrapper, 'cps-client-name', 'Neu');
        await type(wrapper, 'cps-client-key-0', key(7));
        await click(wrapper, TEXT.save);
        expect(writes).toEqual([]);
        expect(wrapper.find('.cps-settings-form__error').text()).toBe(TEXT.notSaved);
    });

    it('a name is plain text: kept as typed (trimmed), never markup', async () => {
        const odd = '{x} @:app.name | <b>y</b>';
        const { wrapper, storedAccess } = await start({ path: '/settings/access/clients/new' });
        await type(wrapper, 'cps-client-name', odd);
        await type(wrapper, 'cps-client-id', 'odd');
        await type(wrapper, 'cps-client-key-0', key(2));
        await click(wrapper, TEXT.save);
        expect(((await storedAccess()).machineClients as { name: string }[])[0]!.name).toBe(odd);
    });
});
