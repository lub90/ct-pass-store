import { describe, expect, it } from 'vitest';
import { createFakeChurchTools } from '@/dev/fake-churchtools';
import { ConflictError, InvalidValueError, ValueTooLargeError } from '@/model/errors';
import type { AccessV2, SettingsV2 } from '@/model/schemas';
import { ChurchToolsKv } from './churchtools-kv';
import { MemoryKv } from './memory-kv';
import { ExtensionStore } from './repository';

const settings: SettingsV2 = {
    schema: 2,
    revision: 1,
    requirePasswordForPasswordChange: false,
    allowCustomPassword: true,
    passwordLength: 16,
    backendUrl: 'https://b.example',
};
const group = { groupId: 1, createdBySetup: true };
const access: AccessV2 = { schema: 2, revision: 1, groups: { users: group, admins: group, service: group }, machineClients: [] };
const setup = (values: string[] = [JSON.stringify(settings)]) => {
    const kv = new MemoryKv({ settings: values, access: [JSON.stringify(access)] });
    return { kv, store: new ExtensionStore(kv) };
};

describe('ExtensionStore reads', () => {
    it('reports a missing value', async () => {
        expect(await setup([]).store.readSettings()).toEqual({ state: 'missing' });
        expect(await new ExtensionStore(new MemoryKv()).readSettings()).toEqual({ state: 'missing' });
    });

    it('reads a valid value', async () => {
        const r = await setup().store.readSettings();
        expect(r).toMatchObject({ state: 'ok', value: settings, duplicates: 0 });
    });

    it('reports newer schemas, invalid values and broken JSON without throwing', async () => {
        expect(await setup([JSON.stringify({ ...settings, schema: 3 })]).store.readSettings()).toEqual({ state: 'newer', schema: 3 });
        const bad = await setup([JSON.stringify({ ...settings, passwordLength: 5 })]).store.readSettings();
        expect(bad.state).toBe('invalid');
        expect(bad.state === 'invalid' && bad.issues[0]).toContain('passwordLength');
        expect((await setup(['{nope']).store.readSettings()).state).toBe('invalid');
        expect((await setup(['[]']).store.readSettings()).state).toBe('invalid');
    });

    it('reads the highest value ID and counts duplicates', async () => {
        const { store } = setup([JSON.stringify({ ...settings, backendUrl: 'old' }), JSON.stringify({ ...settings, backendUrl: 'new' })]);
        const r = await store.readSettings();
        expect(r.state === 'ok' && r.value.backendUrl).toBe('new');
        expect(r.state === 'ok' && r.duplicates).toBe(1);
    });
});

describe('ExtensionStore writes', () => {
    it('raises the revision by 1 and keeps unknown fields', async () => {
        const { store } = setup([JSON.stringify({ ...settings, futureField: { a: 1 } })]);
        const r = await store.readSettings();
        if (r.state !== 'ok') throw new Error('not ok');
        expect(r.value.futureField).toEqual({ a: 1 });
        await store.saveSettings({ ...r.value, passwordLength: 20 }, 1);
        const after = await store.readSettings();
        expect(after).toMatchObject({ state: 'ok', value: { revision: 2, passwordLength: 20, futureField: { a: 1 } } });
    });

    it('keeps unknown stored fields even if the caller dropped them', async () => {
        const { store } = setup([JSON.stringify({ ...settings, futureField: 7 })]);
        await store.saveSettings({ ...settings }, 1);
        expect(await store.readSettings()).toMatchObject({ value: { futureField: 7 } });
    });

    it('rejects invalid values before any write', async () => {
        const { kv, store } = setup();
        for (const passwordLength of [11, 65]) {
            await expect(store.saveSettings({ ...settings, passwordLength }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        }
        await expect(store.saveSettings({ ...settings, texts: { de: { title: 'x'.repeat(61) } } }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv.writes).toEqual([]);
    });

    it('rejects values over 10,000 characters before any write', async () => {
        const { kv, store } = setup();
        const many = Array.from({ length: 100 }, (_, i) => ({
            id: `client-${i}`,
            name: 'n'.repeat(20),
            publicKeys: [btoa('a'.repeat(32))],
            permissions: ['entries:read' as const],
            createdAt: '2026-01-01T00:00:00Z',
        }));
        await expect(store.saveAccess({ ...access, machineClients: many }, 1)).rejects.toBeInstanceOf(ValueTooLargeError);
        expect(kv.writes).toEqual([]);
    });

    it('reports a stale revision as a conflict', async () => {
        const { kv, store } = setup();
        await store.saveSettings(settings, 1);
        kv.writes = [];
        const error = await store.saveSettings(settings, 1).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ConflictError);
        expect((error as ConflictError).current).toBe(2);
        expect(kv.writes).toEqual([]);
    });

    it('creates a missing value with expected revision 0', async () => {
        const { kv, store } = setup([]);
        await store.saveSettings(settings, 0);
        expect(kv.writes.map((w) => w.kind)).toEqual(['create']);
        expect(await store.readSettings()).toMatchObject({ value: { revision: 1 } });
    });

    it('writes the value first and deletes duplicates last', async () => {
        const { kv, store } = setup([JSON.stringify(settings), JSON.stringify(settings), JSON.stringify(settings)]);
        await store.saveSettings(settings, 1);
        expect(kv.writes.map((w) => `${w.kind}:${w.valueId}`)).toEqual(['update:3', 'delete:2', 'delete:1']);
        expect(await store.readSettings()).toMatchObject({ state: 'ok', duplicates: 0 });
    });

    it('never loses the value when interrupted before the deletions', async () => {
        const { kv, store } = setup([JSON.stringify(settings), JSON.stringify(settings)]);
        kv.failFromWrite = 2;
        await expect(store.saveSettings({ ...settings, passwordLength: 30 }, 1)).rejects.toThrow();
        expect(await store.readSettings()).toMatchObject({ state: 'ok', value: { passwordLength: 30 }, duplicates: 1 });
    });
});

describe('ChurchToolsKv', () => {
    it('works through the API layer', async () => {
        const api = createFakeChurchTools({
            moduleKey: 'ctpassstore',
            moduleId: 5,
            currentPersonId: 1,
            persons: [],
            groups: [],
            categories: [{ id: 10, name: 'settings', shorty: 'settings' }],
            values: [{ id: 1, dataCategoryId: 10, value: JSON.stringify(settings) }],
            permissions: {
                view: true,
                'create custom category': true,
                'view custom category': [10],
                'edit custom category': [10],
                'delete custom category': [10],
                'view custom data': [10],
                'create custom data': [10],
                'edit custom data': [10],
                'delete custom data': [10],
            },
        });
        const kv = new ChurchToolsKv(api, 'ctpassstore');
        const store = new ExtensionStore(kv);
        expect(await kv.categoryNames()).toEqual(['settings']);
        expect(await kv.values('access')).toEqual([]);
        await store.saveSettings(settings, 1);
        expect(await store.readSettings()).toMatchObject({ value: { revision: 2 } });
        await expect(kv.create('access', '{}')).rejects.toThrow('does not exist');
    });
});
