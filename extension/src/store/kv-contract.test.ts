import { expect, it } from 'vitest';
import { createFakeChurchTools } from '@/dev/fake-churchtools';
import type { CtValue } from '@/ct/types';
import { ChurchToolsKv } from './churchtools-kv';
import { defineKvContract } from './kv-contract';
import { MemoryKv } from './memory-kv';

export function fakeKv(seed: Record<string, string[]>, options: { shortyOf?: (name: string) => string; extraCategories?: { name: string; shorty: string }[]; key?: string } = {}) {
    const names = Object.keys(seed);
    const categories = [...names.map((name) => ({ name, shorty: options.shortyOf?.(name) ?? name })), ...(options.extraCategories ?? [])].map((c, i) => ({ id: 10 + i, ...c }));
    const values: CtValue[] = [];
    names.forEach((name, i) => seed[name]?.forEach((value) => values.push({ id: values.length + 1, dataCategoryId: 10 + i, value })));
    const ids = categories.map((c) => c.id);
    const api = createFakeChurchTools({
        moduleKey: 'ctpassstore',
        moduleId: 5,
        currentPersonId: 1,
        persons: [],
        groups: [],
        categories,
        values,
        permissions: {
            view: true,
            'create custom category': false,
            'view custom category': ids,
            'edit custom category': [],
            'delete custom category': [],
            'view custom data': ids,
            'create custom data': ids,
            'edit custom data': ids,
            'delete custom data': ids,
        },
    });
    return { api, kv: new ChurchToolsKv(api, options.key ?? 'ctpassstore') };
}

defineKvContract('MemoryKv', (seed) => new MemoryKv(seed));
defineKvContract('ChurchToolsKv over the fake', (seed) => fakeKv(seed).kv);

it('ChurchToolsKv finds a category by name, not by shorty', async () => {
    const { kv } = fakeKv({ settings: ['by-name'], other: ['o'] }, { shortyOf: (n) => (n === 'settings' ? 'other' : 'settings') });
    expect((await kv.values('settings')).map((v) => v.value)).toEqual(['by-name']);
});

it('ChurchToolsKv uses the first of two categories with the same name', async () => {
    const { kv } = fakeKv({ settings: ['first'] }, { extraCategories: [{ name: 'settings', shorty: 'settings2' }] });
    expect((await kv.values('settings')).map((v) => v.value)).toEqual(['first']);
});

it('ChurchToolsKv reports an unknown module', async () => {
    const { kv } = fakeKv({ settings: [] }, { key: 'other' });
    await expect(kv.values('settings')).rejects.toThrow('not found');
});

it('ChurchToolsKv retries the module lookup after a failure', async () => {
    const { api, kv } = fakeKv({ settings: ['a'] });
    api.failNext(500);
    await expect(kv.values('settings')).rejects.toMatchObject({ status: 500 });
    expect((await kv.values('settings')).map((v) => v.value)).toEqual(['a']);
});

it('ChurchToolsKv looks the module up once', async () => {
    const { api, kv } = fakeKv({ settings: ['a'] });
    let calls = 0;
    const original = api.moduleId.bind(api);
    api.moduleId = async (key) => (calls++, original(key));
    await kv.values('settings');
    await kv.values('settings');
    expect(calls).toBe(1);
});

it('ChurchToolsKv propagates typed errors from the API', async () => {
    const { api, kv } = fakeKv({ settings: ['a'] });
    await kv.categoryNames();
    api.failNext(403);
    await expect(kv.values('settings')).rejects.toMatchObject({ name: 'CtForbiddenError' });
});
