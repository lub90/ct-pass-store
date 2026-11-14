import { describe, expect, it } from 'vitest';
import { CtForbiddenError } from '@/ct/errors';
import type { CtValue } from '@/ct/types';
import { ConflictError, InvalidValueError, ValueTooLargeError } from '@/model/errors';
import type { AccessV2, SettingsV2 } from '@/model/schemas';
import type { KvBackend } from './kv';
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
        const { store } = setup([JSON.stringify({ ...settings, backendUrl: 'https://old.example' }), JSON.stringify({ ...settings, backendUrl: 'https://new.example' })]);
        const r = await store.readSettings();
        expect(r.state === 'ok' && r.value.backendUrl).toBe('https://new.example');
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
            publicKeys: [btoa(String(i).padStart(32, '0'))],
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

describe('ExtensionStore fixes', () => {
    it('removes optional fields the caller omits, keeps unknown ones', async () => {
        const { store } = setup([JSON.stringify({ ...settings, oauthClientId: 'abc', texts: { de: { title: 'T' } }, future: 1 })]);
        await store.saveSettings({ ...settings }, 1);
        const r = await store.readSettings();
        expect(r.state === 'ok' && r.value.texts).toBeUndefined();
        expect(r.state === 'ok' && r.value.oauthClientId).toBeUndefined();
        expect(r).toMatchObject({ value: { future: 1 } });
    });

    it('drops invalid texts on read with an issue, other fields stay strict', async () => {
        for (const texts of [{ de: { title: 5 } }, { de: { title: 'x'.repeat(61) } }]) {
            const r = await setup([JSON.stringify({ ...settings, texts })]).store.readSettings();
            expect(r.state).toBe('ok');
            if (r.state !== 'ok') return;
            expect(r.value.texts).toBeUndefined();
            expect(r.issues?.[0]).toContain('texts');
        }
        expect((await setup([JSON.stringify({ ...settings, texts: 3, passwordLength: 1 })]).store.readSettings()).state).toBe('invalid');
    });

    it('strips a trailing slash from backendUrl and rejects unsafe URLs', async () => {
        const { store } = setup();
        await store.saveSettings({ ...settings, backendUrl: 'https://b.example/api//' }, 1);
        expect(await store.readSettings()).toMatchObject({ value: { backendUrl: 'https://b.example/api' } });
        for (const backendUrl of ['http://b.example', 'https://u:p@b.example', 'https://b.example?x=1', 'https://b.example#f', 'nonsense']) {
            await expect(store.saveSettings({ ...settings, backendUrl }, 2)).rejects.toBeInstanceOf(InvalidValueError);
        }
        const without: SettingsV2 = { ...settings };
        delete without.backendUrl;
        await store.saveSettings(without, 2);
    });
});

describe('ExtensionStore malformed keys', () => {
    it('leaves a client with malformed public keys out with an issue, not throwing', async () => {
        for (const bad of ['!!!', 'AAAAA']) {
            const stored = { ...access, machineClients: [{ id: 'abc', name: 'n', publicKeys: [bad], permissions: ['entries:read'], createdAt: 'x' }] };
            const r = await new ExtensionStore(new MemoryKv({ access: [JSON.stringify(stored)] })).readAccess();
            expect(r).toMatchObject({ state: 'ok', value: { machineClients: [] } });
            expect(r.state === 'ok' && r.issues?.length).toBeGreaterThan(0);
        }
    });
});

// ---- Hardening (review findings) ----
/** Fixed values in the given order, records writes. */
class StubKv implements KvBackend {
    writes: string[] = [];
    private list: CtValue[];
    constructor(list: CtValue[]) {
        this.list = list;
    }
    async categoryNames() { return ['settings']; }
    async values() { return this.list.map((v) => ({ ...v })); }
    async create(_c: string, value: string) { this.writes.push('create'); return { id: 100, dataCategoryId: 1, value }; }
    async update(_c: string, id: number) { this.writes.push(`update:${id}`); return { id, dataCategoryId: 1, value: '' }; }
    async delete(_c: string, id: number) { this.writes.push(`delete:${id}`); }
}
const stored = (id: number, value: unknown): CtValue => ({ id, dataCategoryId: 1, value: JSON.stringify(value) });

describe('highest value ID', () => {
    it('wins regardless of the order the KV returns; save deletes the others', async () => {
        const kv = new StubKv([stored(5, { ...settings, backendUrl: 'https://five.example' }), stored(9, { ...settings, backendUrl: 'https://nine.example' }), stored(2, settings)]);
        const store = new ExtensionStore(kv);
        const r = await store.readSettings();
        expect(r).toMatchObject({ state: 'ok', valueId: 9, duplicates: 2, value: { backendUrl: 'https://nine.example' } });
        await store.saveSettings(settings, 1);
        expect(kv.writes).toEqual(['update:9', 'delete:5', 'delete:2']);
    });
});

describe('save over odd stored values', () => {
    const attempt = async (storedValue: string | undefined, expected: number) => {
        const kv = new MemoryKv({ settings: storedValue === undefined ? [] : [storedValue] });
        const error = await new ExtensionStore(kv).saveSettings(settings, expected).catch((e: unknown) => e);
        return { kv, error };
    };
    it('refuses to overwrite a newer schema, whatever the expected revision', async () => {
        for (const expected of [0, 1, 5]) {
            const { kv, error } = await attempt(JSON.stringify({ schema: 3, revision: expected }), expected);
            expect(error).toBeInstanceOf(InvalidValueError);
            expect(kv.writes).toEqual([]);
        }
    });
    it.each([
        ['unparsable JSON', '{nope'],
        ['an array', '[1,2]'],
        ['a value without revision', JSON.stringify({ schema: 2 })],
        ['a non-numeric revision', JSON.stringify({ schema: 2, revision: 'x' })],
        ['a fractional revision', JSON.stringify({ schema: 2, revision: 1.5 })],
        ['null', 'null'],
    ])('%s counts as revision 0: replaced with expected 0, conflict otherwise', async (_n, value) => {
        const wrong = await attempt(value, 1);
        expect(wrong.error).toBeInstanceOf(ConflictError);
        expect((wrong.error as ConflictError).current).toBe(0);
        expect(wrong.kv.writes).toEqual([]);
        const right = await attempt(value, 0);
        expect(right.error).toBeUndefined();
        expect(right.kv.writes.map((w) => w.kind)).toEqual(['update']);
    });
    it('conflicts on a missing value with expected revision other than 0', async () => {
        const { kv, error } = await attempt(undefined, 3);
        expect(error).toBeInstanceOf(ConflictError);
        expect((error as ConflictError).current).toBe(0);
        expect(kv.writes).toEqual([]);
    });
});

describe('10,000 character limit', () => {
    const baseLength = JSON.stringify({ ...settings, revision: 2, future: '' }).length;
    const withLength = (total: number): SettingsV2 => ({ ...settings, future: 'x'.repeat(total - baseLength) });
    it('writes exactly 10,000 characters', async () => {
        const kv = new MemoryKv({ settings: [JSON.stringify(settings)] });
        await new ExtensionStore(kv).saveSettings(withLength(10_000), 1);
        expect(kv.writes[0]?.value?.length).toBe(10_000);
    });
    it('rejects 10,001 without a write', async () => {
        const kv = new MemoryKv({ settings: [JSON.stringify(settings)] });
        await expect(new ExtensionStore(kv).saveSettings(withLength(10_001), 1)).rejects.toBeInstanceOf(ValueTooLargeError);
        expect(kv.writes).toEqual([]);
    });
    it('rejects when a large unknown stored field pushes the merged value over', async () => {
        const kv = new MemoryKv({ settings: [JSON.stringify({ ...settings, big: 'y'.repeat(9_900) })] });
        await expect(new ExtensionStore(kv).saveSettings({ ...settings, oauthClientId: 'z'.repeat(200) }, 1)).rejects.toBeInstanceOf(ValueTooLargeError);
        expect(kv.writes).toEqual([]);
    });
});

describe('reads never throw on stored content', () => {
    const contents = ['null', '5', '"x"', 'true', '[]', '{}', JSON.stringify({ schema: '3' }), JSON.stringify({ schema: 1 }), JSON.stringify({ revision: 1 })];
    it.each(contents)('%s is invalid for settings and access', async (content) => {
        const store = new ExtensionStore(new MemoryKv({ settings: [content], access: [content] }));
        for (const r of [await store.readSettings(), await store.readAccess()]) {
            expect(r.state).toBe('invalid');
            expect(r.state === 'invalid' && r.issues.length).toBeGreaterThan(0);
        }
    });
    it('truncates issue strings that echo huge values', async () => {
        const r = await setup([JSON.stringify({ ...settings, passwordLength: 'x'.repeat(50_000) })]).store.readSettings();
        expect(r.state === 'invalid' && r.issues.every((i) => i.length <= 200)).toBe(true);
    });
    it('propagates transport and permission errors (R1)', async () => {
        const kv = new MemoryKv();
        kv.values = async () => { throw new CtForbiddenError('no', 'view custom data'); };
        const store = new ExtensionStore(kv);
        await expect(store.readSettings()).rejects.toBeInstanceOf(CtForbiddenError);
        await expect(store.readAccess()).rejects.toBeInstanceOf(CtForbiddenError);
        await expect(store.saveSettings(settings, 1)).rejects.toBeInstanceOf(CtForbiddenError);
        kv.values = async () => { throw new TypeError('network'); };
        await expect(store.readSettings()).rejects.toThrow('network');
    });
});

describe('texts that are not objects (R: tolerant)', () => {
    it.each([[3], ['x'], [null], [[]], [{ de: 'x' }]])('%j is dropped with an issue', async (texts) => {
        const r = await setup([JSON.stringify({ ...settings, texts })]).store.readSettings();
        expect(r.state).toBe('ok');
        expect(r.state === 'ok' && r.value.texts).toBeUndefined();
        expect(r.state === 'ok' && r.issues?.[0]).toContain('texts');
    });
    it.each(['de', 'en'])('too long %s intro (301) and title (61) are dropped', async (lang) => {
        for (const texts of [{ [lang]: { intro: 'x'.repeat(301) } }, { [lang]: { title: 'x'.repeat(61) } }]) {
            const r = await setup([JSON.stringify({ ...settings, texts })]).store.readSettings();
            expect(r.state === 'ok' && r.value.texts).toBeUndefined();
            expect(r.state === 'ok' && r.issues?.length).toBe(1);
        }
    });
});

describe('retired v1 fields (R3)', () => {
    it('are left out of the value and dropped on save, real unknown fields survive', async () => {
        const old = { ...settings, adminUsers: [1], readAccessUsers: [2], machineClients: [{ id: 'x' }], future: 'keep' };
        const { kv, store } = setup([JSON.stringify(old)]);
        const r = await store.readSettings();
        expect(r.state === 'ok' && 'adminUsers' in r.value).toBe(false);
        expect(r.state === 'ok' && 'machineClients' in r.value).toBe(false);
        expect(r.state === 'ok' && r.value.future).toBe('keep');
        await store.saveSettings(settings, 1);
        const written = JSON.parse(kv.writes[0]?.value ?? '{}') as Record<string, unknown>;
        expect(Object.keys(written)).not.toContain('adminUsers');
        expect(Object.keys(written)).not.toContain('readAccessUsers');
        expect(Object.keys(written)).not.toContain('machineClients');
        expect(written.future).toBe('keep');
    });
    it('are dropped even if the caller passes them in', async () => {
        const { kv, store } = setup();
        await store.saveSettings({ ...settings, adminUsers: [1] }, 1);
        expect(JSON.parse(kv.writes[0]?.value ?? '{}')).not.toHaveProperty('adminUsers');
    });
});

describe('access: tolerant per machine client (R2)', () => {
    const good = { id: 'good', name: 'Good', publicKeys: [btoa('g'.repeat(32))], permissions: ['entries:read'], createdAt: 'x' };
    const bad = { id: 'BAD', name: 'Bad', publicKeys: ['!!!'], permissions: ['entries:read'], createdAt: 'x' };
    const run = (clients: unknown) => {
        const stored = { ...access, machineClients: clients, future: 1 };
        const kv = new MemoryKv({ access: [JSON.stringify(stored)] });
        return { kv, store: new ExtensionStore(kv) };
    };
    it('treats a missing machineClients as empty', async () => {
        const stored: Record<string, unknown> = { ...access };
        delete stored.machineClients;
        const r = await new ExtensionStore(new MemoryKv({ access: [JSON.stringify(stored)] })).readAccess();
        expect(r).toMatchObject({ state: 'ok', value: { machineClients: [] } });
    });
    it('leaves an invalid client out with an issue and keeps it unchanged on save', async () => {
        const { kv, store } = run([good, bad]);
        const r = await store.readAccess();
        if (r.state !== 'ok') throw new Error('not ok');
        expect(r.value.machineClients.map((c) => c.id)).toEqual(['good']);
        expect(r.issues?.length).toBeGreaterThan(0);
        await store.saveAccess({ ...r.value, machineClients: [] }, 1);
        const written = JSON.parse(kv.writes[0]?.value ?? '{}') as { machineClients: unknown[] };
        expect(written.machineClients).toEqual([bad]);
    });
    it('drops an unknown permission with an issue', async () => {
        const r = await run([{ ...good, permissions: ['entries:read', '*'] }]).store.readAccess();
        expect(r.state === 'ok' && r.value.machineClients[0]?.permissions).toEqual(['entries:read']);
        expect(r.state === 'ok' && r.issues?.length).toBe(1);
    });
    it('leaves out all clients with a duplicate id or a shared key', async () => {
        const dup = await run([good, { ...good, publicKeys: [btoa('h'.repeat(32))] }, { ...good, id: 'third', publicKeys: [btoa('t'.repeat(32))] }]).store.readAccess();
        expect(dup.state === 'ok' && dup.value.machineClients.map((c) => c.id)).toEqual(['third']);
        const shared = await run([good, { ...good, id: 'second' }]).store.readAccess();
        expect(shared.state === 'ok' && shared.value.machineClients).toEqual([]);
        expect(shared.state === 'ok' && shared.issues?.length).toBe(2);
    });
    it('keeps groups strict and non-array machineClients invalid', async () => {
        const kv = new MemoryKv({ access: [JSON.stringify({ ...access, groups: { users: g0() } })] });
        expect((await new ExtensionStore(kv).readAccess()).state).toBe('invalid');
        expect((await run('x').store.readAccess()).state).toBe('invalid');
    });
    it('still rejects a strictly invalid client on save', async () => {
        const { store } = run([good]);
        await expect(store.saveAccess({ ...access, machineClients: [bad as never] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
    });
});
function g0() {
    return { groupId: 1, createdBySetup: true };
}
