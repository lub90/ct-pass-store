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

describe('ExtensionStore.readStartup().oldLayout (spec 6.3)', () => {
    const old = JSON.stringify({ adminUsers: [1], readAccessUsers: [2] });
    it('is true for an unversioned settings value with old fields', async () => {
        expect(await new ExtensionStore(new MemoryKv({ settings: [old] })).readStartup().then((s) => s.oldLayout)).toBe(true);
        expect(await new ExtensionStore(new MemoryKv({ settings: [JSON.stringify({ readAccessUsers: [] })] })).readStartup().then((s) => s.oldLayout)).toBe(true);
    });
    it('is true when a setupCompleted category exists', async () => {
        expect(await new ExtensionStore(new MemoryKv({ settings: [JSON.stringify(settings)], setupCompleted: [] })).readStartup().then((s) => s.oldLayout)).toBe(true);
    });
    it('reads the newest settings value', async () => {
        expect(await new ExtensionStore(new MemoryKv({ settings: [JSON.stringify(settings), old] })).readStartup().then((s) => s.oldLayout)).toBe(true);
        expect(await new ExtensionStore(new MemoryKv({ settings: [old, JSON.stringify(settings)] })).readStartup().then((s) => s.oldLayout)).toBe(false);
    });
    it('is false for the new layout, nothing stored and broken JSON', async () => {
        expect(await setup().store.readStartup().then((s) => s.oldLayout)).toBe(false);
        expect(await new ExtensionStore(new MemoryKv()).readStartup().then((s) => s.oldLayout)).toBe(false);
        expect(await new ExtensionStore(new MemoryKv({ settings: ['{nope'] })).readStartup().then((s) => s.oldLayout)).toBe(false);
        expect(await new ExtensionStore(new MemoryKv({ settings: [JSON.stringify({ ...settings, adminUsers: [1] })] })).readStartup().then((s) => s.oldLayout)).toBe(false);
    });
});

describe('ExtensionStore.readStartup (layout and settings in one read)', () => {
    const old = JSON.stringify({ adminUsers: [1], readAccessUsers: [2] });
    const counted = (kv: MemoryKv) => {
        const listed: string[] = [];
        const values = kv.values.bind(kv);
        kv.values = (category: string) => (listed.push(category), values(category));
        return listed;
    };

    it('lists the settings values once and gives the layout and the settings read', async () => {
        const seeds: [Record<string, string[]>, boolean][] = [
            [{ settings: [JSON.stringify(settings)] }, false],
            [{ settings: [old] }, true],
            [{ settings: [JSON.stringify(settings)], setupCompleted: [] }, true],
            [{}, false],
            [{ settings: ['{nope'] }, false],
        ];
        for (const [seed, oldLayout] of seeds) {
            const kv = new MemoryKv(seed);
            const listed = counted(kv);
            const store = new ExtensionStore(kv);
            const startup = await store.readStartup();
            expect(listed).toEqual(['settings']);
            expect(startup).toEqual({ oldLayout, settings: await store.readSettings() });
        }
    });

    it('passes KV errors on', async () => {
        const kv = new MemoryKv({ settings: [old] });
        kv.categoryNames = async () => {
            throw new CtForbiddenError();
        };
        await expect(new ExtensionStore(kv).readStartup()).rejects.toBeInstanceOf(CtForbiddenError);
    });
});

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
            createdAt: '2026-01-01',
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
            const stored = { ...access, machineClients: [{ id: 'abc', name: 'n', publicKeys: [bad], permissions: ['entries:read'], createdAt: '2026-01-01' }] };
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
    const good = { id: 'good', name: 'Good', publicKeys: [btoa('g'.repeat(32))], permissions: ['entries:read'], createdAt: '2026-01-01' };
    const bad = { id: 'BAD', name: 'Bad', publicKeys: ['!!!'], permissions: ['entries:read'], createdAt: '2026-01-01' };
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
        const { kv, store } = run([good]);
        await expect(store.saveAccess({ ...access, machineClients: [bad as never] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv.writes).toEqual([]);
    });
});
function g0() {
    return { groupId: 1, createdBySetup: true };
}

describe('preserved machine clients vs new ones', () => {
    const k = (c: string) => btoa(c.repeat(32));
    const url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const mk = (id: string, key: string) => ({ id, name: id, publicKeys: [key], permissions: ['entries:read'] as 'entries:read'[], createdAt: '2026-01-01' });
    const run = (clients: unknown[]) => {
        const kv = new MemoryKv({ access: [JSON.stringify({ ...access, machineClients: clients })] });
        return { kv, store: new ExtensionStore(kv) };
    };
    const badId = { id: 'abc', name: 'bad', publicKeys: ['!!!'], permissions: ['entries:read'], createdAt: '2026-01-01' };

    it('rejects a new client whose id equals a preserved entry, with no write', async () => {
        const { kv, store } = run([badId]);
        await expect(store.saveAccess({ ...access, machineClients: [mk('abc', k('n'))] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv.writes).toEqual([]);
    });
    it('rejects a new client sharing a decodable key with a preserved entry (base64 vs base64url)', async () => {
        const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(251)));
        const { kv, store } = run([{ id: 'BAD-ID', name: 'x', publicKeys: [key], permissions: ['entries:read'], createdAt: '2026-01-01' }]);
        await expect(store.saveAccess({ ...access, machineClients: [mk('fresh', url(key))] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv.writes).toEqual([]);
    });
    it('rejects a new client colliding with a client that was left out only because of a conflict', async () => {
        const { kv, store } = run([mk('dup', k('a')), mk('dup', k('b'))]);
        await expect(store.saveAccess({ ...access, machineClients: [mk('dup', k('c'))] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        await expect(store.saveAccess({ ...access, machineClients: [mk('other', k('a'))] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv.writes).toEqual([]);
    });
    it('keeps the preserved entry unchanged next to a non-colliding new client', async () => {
        const { kv, store } = run([badId]);
        const fresh = mk('fresh', k('n'));
        await store.saveAccess({ ...access, machineClients: [fresh] }, 1);
        expect((JSON.parse(kv.writes[0]?.value ?? '{}') as { machineClients: unknown[] }).machineClients).toEqual([fresh, badId]);
    });
});

describe('invalid reads carry their revision', () => {
    it('reports the stored revision so a repair save can use it', async () => {
        const { store } = setup([JSON.stringify({ ...settings, revision: 3, passwordLength: 99 })]);
        expect(await store.readSettings()).toMatchObject({ state: 'invalid', revision: 3 });
        await store.saveSettings(settings, 3);
        expect(await store.readSettings()).toMatchObject({ state: 'ok', value: { revision: 4, passwordLength: 16 } });
    });
    it('has no revision when none is usable', async () => {
        for (const content of ['{nope', '5', JSON.stringify({ revision: 'x' }), JSON.stringify({ revision: 1.5 })]) {
            const r = await setup([content]).store.readSettings();
            expect(r.state === 'invalid' && r.revision).toBeUndefined();
        }
    });
});

describe('invalid reads say what a repair keeps', () => {
    it('lists the known fields valid on their own (kept) and the ones present but invalid (broken)', async () => {
        const stored = { ...settings, revision: 3, passwordLength: 99, allowCustomPassword: 'yes', oauthClientId: 'oauth-1', future: 1 };
        const r = await setup([JSON.stringify(stored)]).store.readSettings();
        expect(r).toMatchObject({ state: 'invalid', revision: 3 });
        if (r.state !== 'invalid') throw new Error('not invalid');
        expect(r.repair).toStrictEqual({
            kept: { requirePasswordForPasswordChange: false, backendUrl: 'https://b.example', oauthClientId: 'oauth-1' },
            broken: ['allowCustomPassword', 'passwordLength'],
            brokenValues: { allowCustomPassword: 'yes', passwordLength: 99 },
        });
    });
    it('names an invalid backendUrl or oauthClientId as broken, never kept', async () => {
        const r = await setup([JSON.stringify({ ...settings, passwordLength: 99, backendUrl: 'http://b.example', oauthClientId: '' })]).store.readSettings();
        expect(r.state === 'invalid' && r.repair).toStrictEqual({
            kept: { requirePasswordForPasswordChange: false, allowCustomPassword: true },
            broken: ['passwordLength', 'backendUrl', 'oauthClientId'],
            brokenValues: { passwordLength: 99, backendUrl: 'http://b.example', oauthClientId: '' },
        });
    });
    it('keeps valid texts; invalid texts are dropped as before (an issue, neither kept nor broken)', async () => {
        const texts = { de: { title: 'Hallo' } };
        const kept = await setup([JSON.stringify({ ...settings, passwordLength: 99, texts })]).store.readSettings();
        expect(kept.state === 'invalid' && kept.repair?.kept.texts).toEqual(texts);
        const dropped = await setup([JSON.stringify({ ...settings, passwordLength: 99, texts: { de: { title: 'x'.repeat(61) } } })]).store.readSettings();
        expect(dropped.state === 'invalid' && dropped.repair).toEqual({
            kept: expect.not.objectContaining({ texts: expect.anything() }),
            broken: ['passwordLength'],
            brokenValues: { passwordLength: 99 },
        });
        expect(dropped.state === 'invalid' && dropped.issues.some((i) => i.startsWith('texts.'))).toBe(true);
    });
    it('offers no repair without schema 2 or without a usable revision (old layout, garbage, unversioned)', async () => {
        for (const content of [
            '{nope',
            '5',
            JSON.stringify({ adminUsers: [1], readAccessUsers: [2] }),
            JSON.stringify({ ...settings, schema: 1 }),
            JSON.stringify({ ...settings, schema: undefined, passwordLength: 99 }),
            JSON.stringify({ ...settings, revision: 'x' }),
            JSON.stringify({ ...settings, revision: 1.5 }),
            JSON.stringify({ ...settings, revision: -1, passwordLength: 99 }),
            JSON.stringify({ ...settings, revision: Number.MAX_SAFE_INTEGER, passwordLength: 99 }),
            JSON.stringify({ ...settings, revision: 2 ** 60, passwordLength: 99 }),
        ]) {
            const r = await setup([content]).store.readSettings();
            expect(r.state, content).toBe('invalid');
            expect(r.state === 'invalid' && r.repair, content).toBeUndefined();
        }
    });
});

describe('repair details: absent fields, access, texts without revision', () => {
    it('an absent optional field is neither kept nor broken', async () => {
        const noUrl: Partial<SettingsV2> = { ...settings };
        delete noUrl.backendUrl;
        const r = await setup([JSON.stringify({ ...noUrl, passwordLength: 99 })]).store.readSettings();
        expect(r.state === 'invalid' && r.repair).toStrictEqual({
            kept: { requirePasswordForPasswordChange: false, allowCustomPassword: true },
            broken: ['passwordLength'],
            brokenValues: { passwordLength: 99 },
        });
    });
    it('an invalid access read has no repair (settings only)', async () => {
        const kv = new MemoryKv({ settings: [JSON.stringify(settings)], access: [JSON.stringify({ ...access, revision: 3, groups: 'x' })] });
        const r = await new ExtensionStore(kv).readAccess();
        expect(r).toMatchObject({ state: 'invalid', revision: 3 });
        expect(r.state === 'invalid' && 'repair' in r).toBe(false);
    });
    it('an invalid read without a usable revision also reports dropped texts', async () => {
        const r = await setup([JSON.stringify({ ...settings, revision: 'x', texts: { de: { title: 'x'.repeat(61) } } })]).store.readSettings();
        expect(r.state).toBe('invalid');
        expect(r.state === 'invalid' && r.issues.some((i) => i.startsWith('texts.'))).toBe(true);
    });
    it('stored texts with bidi controls are dropped with an issue, like other invalid texts', async () => {
        const r = await setup([JSON.stringify({ ...settings, texts: { de: { title: 'a\u202Eb' } } })]).store.readSettings();
        expect(r).toMatchObject({ state: 'ok' });
        expect(r.state === 'ok' && r.value.texts).toBeUndefined();
        expect(r.state === 'ok' && r.issues?.some((i) => i.startsWith('texts.de.title'))).toBe(true);
    });
});

describe('revisions out of the safe range (never a stale overwrite)', () => {
    it.each([-1, Number.MAX_SAFE_INTEGER, 2 ** 60])('a stored integer revision %s refuses every save', async (revision) => {
        const { store, kv } = setup([JSON.stringify({ ...settings, revision })]);
        for (const expected of [0, revision, revision - 1]) {
            await expect(store.saveSettings(settings, expected)).rejects.toBeInstanceOf(InvalidValueError);
        }
        expect(JSON.parse((await kv.values('settings'))[0]!.value)).toMatchObject({ revision });
    });
    it('the highest usable revision still saves (to MAX_SAFE_INTEGER - 1)', async () => {
        const top = Number.MAX_SAFE_INTEGER - 2;
        const { store } = setup([JSON.stringify({ ...settings, revision: top })]);
        await store.saveSettings(settings, top);
        expect(await store.readSettings()).toMatchObject({ state: 'ok', value: { revision: top + 1 } });
    });
});

describe('unusable machine clients are listed and removable', () => {
    const key = (c: string) => btoa(c.repeat(32));
    const ok = (id: string, c: string) => ({ id, name: id, publicKeys: [key(c)], permissions: ['entries:read'], createdAt: '2026-01-01' });
    const noName = { id: 'noname', publicKeys: [key('n')], permissions: ['entries:read'], createdAt: '2026-01-01' };
    const run = (clients: unknown[]) => {
        const kv = new MemoryKv({ access: [JSON.stringify({ ...access, machineClients: clients })] });
        return { kv, store: new ExtensionStore(kv) };
    };
    const written = (kv: MemoryKv) => (JSON.parse(kv.writes[0]?.value ?? '{}') as { machineClients: unknown[] }).machineClients;

    it('lists index, raw id and reason codes of each entry the backend disables', async () => {
        const r = await run([ok('good', 'g'), noName, 'text', null, ok('dup', 'd'), ok('dup', 'e')]).store.readAccess();
        expect(r.state === 'ok' && r.value.machineClients.map((c) => c.id)).toEqual(['good']);
        expect(r.state === 'ok' && r.unusable).toEqual([
            { index: 1, id: 'noname', reasons: ['missing-name'] },
            { index: 2, reasons: ['not-an-object'] },
            { index: 3, reasons: ['not-an-object'] },
            { index: 4, id: 'dup', reasons: ['duplicate-id'] },
            { index: 5, id: 'dup', reasons: ['duplicate-id'] },
        ]);
    });

    it('has no unusable list when everything is fine', async () => {
        const r = await run([ok('good', 'g')]).store.readAccess();
        expect(r.state === 'ok' && r.unusable).toBeUndefined();
    });

    it('drops the listed entries on save and keeps all other unusable ones unchanged (also non-objects)', async () => {
        const { kv, store } = run([ok('good', 'g'), noName, 'text', null]);
        const r = await store.readAccess();
        if (r.state !== 'ok') throw new Error('not ok');
        await store.saveAccess(r.value, 1, [{ index: 1, id: 'noname' }, { index: 3 }]);
        expect(written(kv)).toEqual([ok('good', 'g'), 'text']);
    });

    it('makes every stored client removable, including the earlier one of a duplicate pair', async () => {
        const { kv, store } = run([ok('dup', 'd'), ok('dup', 'e'), noName]);
        const r = await store.readAccess();
        if (r.state !== 'ok') throw new Error('not ok');
        await store.saveAccess(r.value, 1, r.unusable);
        expect(written(kv)).toEqual([]);
    });

    it('keeps a non-object entry that is preserved on a plain save', async () => {
        const { kv, store } = run(['text']);
        await store.saveAccess({ ...access, machineClients: [] }, 1);
        expect(written(kv)).toEqual(['text']);
    });

    it('still finds a collision after a non-object preserved entry', async () => {
        const { kv, store } = run([null, 'text', { ...noName, id: 'clash' }]);
        await expect(store.saveAccess({ ...access, machineClients: [ok('clash', 'c') as never] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv.writes).toEqual([]);
    });

    it('does not let a dropped entry collide any more', async () => {
        const { kv, store } = run([{ ...noName, id: 'clash' }]);
        await store.saveAccess({ ...access, machineClients: [ok('clash', 'c') as never] }, 1, [{ index: 0, id: 'clash' }]);
        expect(written(kv)).toEqual([ok('clash', 'c')]);
    });

    it('lists unusable entries on an invalid read too, when machineClients is a list (M1)', async () => {
        const kv = new MemoryKv({ access: [JSON.stringify({ ...access, groups: 'broken', machineClients: [ok('good', 'g'), noName] })] });
        const r = await new ExtensionStore(kv).readAccess();
        expect(r.state).toBe('invalid');
        expect(r.state === 'invalid' && r.unusable).toEqual([{ index: 1, id: 'noname', reasons: ['missing-name'] }]);
    });

    it('an invalid read whose machineClients is no list has no unusable list', async () => {
        const kv = new MemoryKv({ access: [JSON.stringify({ ...access, groups: 'broken', machineClients: { a: 1 } })] });
        const r = await new ExtensionStore(kv).readAccess();
        expect(r.state === 'invalid' && r.unusable).toBeUndefined();
    });

    it('refuses to drop when the stored entry at that index has another id (stale index, M2): nothing written', async () => {
        const { kv, store } = run([ok('good', 'g'), { ...noName, id: 'other' }]);
        await expect(store.saveAccess({ ...access, machineClients: [ok('good', 'g') as never] }, 1, [{ index: 1, id: 'noname' }])).rejects.toBeInstanceOf(ConflictError);
        expect(kv.writes).toEqual([]);
    });

    it('refuses to drop by an id when the stored entry has none, and the other way round (M2)', async () => {
        const a = run(['text']);
        await expect(a.store.saveAccess({ ...access, machineClients: [] }, 1, [{ index: 0, id: 'text' }])).rejects.toBeInstanceOf(ConflictError);
        const b = run([noName]);
        await expect(b.store.saveAccess({ ...access, machineClients: [] }, 1, [{ index: 0 }])).rejects.toBeInstanceOf(ConflictError);
        expect([...a.kv.writes, ...b.kv.writes]).toEqual([]);
    });

    it('refuses to drop an index that is no unusable entry (any more), or is out of range (M2)', async () => {
        const { kv, store } = run([ok('good', 'g')]);
        await expect(store.saveAccess({ ...access, machineClients: [ok('good', 'g') as never] }, 1, [{ index: 0, id: 'good' }])).rejects.toBeInstanceOf(ConflictError);
        await expect(store.saveAccess({ ...access, machineClients: [ok('good', 'g') as never] }, 1, [{ index: 5 }])).rejects.toBeInstanceOf(ConflictError);
        expect(kv.writes).toEqual([]);
    });

    it('M2 pins the index: the same unusable id at another index is refused, nothing written (I3a)', async () => {
        const { kv, store } = run([ok('aaa', 'a'), noName]);
        await expect(store.saveAccess({ ...access, machineClients: [ok('aaa', 'a') as never] }, 1, [{ index: 0, id: 'noname' }])).rejects.toBeInstanceOf(ConflictError);
        expect(kv.writes).toEqual([]);
    });

    it('M2 with the read entry: a shifted list of same-id duplicates never drops the wrong one (I3b)', async () => {
        const dupA = { ...ok('dup', 'd'), name: 'A' };
        const dupB = { ...ok('dup', 'e'), name: 'B' };
        // Read as [dupA, dupB]; meanwhile (revision unchanged) an entry was put in front.
        const { kv, store } = run([noName, dupA, dupB]);
        await expect(store.saveAccess({ ...access, machineClients: [] }, 1, [{ index: 1, id: 'dup', entry: dupB }])).rejects.toBeInstanceOf(ConflictError);
        expect(kv.writes).toEqual([]);
        await store.saveAccess({ ...access, machineClients: [] }, 1, [{ index: 2, id: 'dup', entry: dupB }]);
        expect(written(kv)).toEqual([noName, dupA]);
    });

    it('does not write an unknown permission back, and refuses to write one', async () => {
        const { kv, store } = run([{ ...ok('perm', 'p'), permissions: ['entries:read', '*'] }]);
        const r = await store.readAccess();
        if (r.state !== 'ok') throw new Error('not ok');
        await store.saveAccess(r.value, 1);
        expect(written(kv)).toEqual([ok('perm', 'p')]);
        const kv2 = run([]);
        await expect(kv2.store.saveAccess({ ...access, machineClients: [{ ...ok('perm', 'p'), permissions: ['*'] } as never] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv2.kv.writes).toEqual([]);
    });
});

describe('stored machine client entries, and removing them from a value of any state (F1)', () => {
    const key = (c: string) => btoa(c.repeat(32));
    const ok = (id: string, c: string) => ({ id, name: id, publicKeys: [key(c)], permissions: ['entries:read'], createdAt: '2026-01-01' });
    const noName = { id: 'noname', publicKeys: [key('n')], permissions: ['entries:read'], createdAt: '2026-01-01' };
    /** `access` the extension reads as invalid, while the backend (groups.admins and machineClients only) enables clients. */
    const brokenGroups = { ...group, createdBySetup: 'x' };
    const invalidAccess = (clients: unknown[], extra: Record<string, unknown> = {}) => ({ ...access, groups: { ...access.groups, service: brokenGroups }, machineClients: clients, note: { kept: [1, 'x'] }, ...extra });
    const run = (value: unknown) => {
        const kv = new MemoryKv({ access: [JSON.stringify(value)] });
        return { kv, store: new ExtensionStore(kv) };
    };
    const stored = async (kv: MemoryKv) => JSON.parse((await kv.values('access'))[0]!.value) as Record<string, unknown>;

    it('an ok read lists every stored entry with its raw value, reasons and (if enabled) the client', async () => {
        const r = await run({ ...access, machineClients: [ok('good', 'g'), noName] }).store.readAccess();
        expect(r.state === 'ok' && r.clientEntries).toEqual([
            { index: 0, id: 'good', reasons: [], raw: ok('good', 'g'), client: ok('good', 'g') },
            { index: 1, id: 'noname', reasons: ['missing-name'], raw: noName },
        ]);
    });

    it('an invalid read whose machineClients is a list still lists the clients the backend enables, with the revision', async () => {
        const r = await run(invalidAccess([ok('reader', 'r'), noName])).store.readAccess();
        expect(r.state).toBe('invalid');
        if (r.state !== 'invalid') return;
        expect(r.revision).toBe(1);
        expect(r.clientEntries?.map((e) => [e.index, e.id, e.reasons, e.client?.id])).toEqual([
            [0, 'reader', [], 'reader'],
            [1, 'noname', ['missing-name'], undefined],
        ]);
    });

    it('removes an enabled client from an invalid value: only machineClients and the revision change', async () => {
        const value = invalidAccess([ok('reader', 'r'), noName]);
        const { kv, store } = run(value);
        await store.removeClients(1, [{ index: 0, id: 'reader', entry: ok('reader', 'r') }]);
        expect(await stored(kv)).toEqual({ ...value, machineClients: [noName], revision: 2 });
        expect(Object.keys(await stored(kv))).toEqual(Object.keys(value));
    });

    it('removes several entries at once (enabled and unusable)', async () => {
        const { kv, store } = run({ ...access, machineClients: [ok('a', 'a'), noName, 'text', ok('b', 'b')] });
        await store.removeClients(1, [
            { index: 1, id: 'noname', entry: noName },
            { index: 3, id: 'b', entry: ok('b', 'b') },
        ]);
        expect((await stored(kv)).machineClients).toEqual([ok('a', 'a'), 'text']);
    });

    it.each([
        ['another revision', 2, [{ index: 0, id: 'reader', entry: ok('reader', 'r') }]],
        ['another id at the index', 1, [{ index: 0, id: 'noname', entry: noName }]],
        ['another entry at the index (same id)', 1, [{ index: 0, id: 'reader', entry: { ...ok('reader', 'r'), name: 'other' } }]],
        ['an index out of range', 1, [{ index: 5, id: 'reader', entry: ok('reader', 'r') }]],
        ['an id given for an entry without one', 1, [{ index: 2, id: 'text', entry: 'text' }]],
    ])('refuses %s: ConflictError, nothing written', async (_n, revision, drop) => {
        const { kv, store } = run(invalidAccess([ok('reader', 'r'), noName, 'text']));
        await expect(store.removeClients(revision, drop)).rejects.toBeInstanceOf(ConflictError);
        expect(kv.writes).toEqual([]);
    });

    it.each([
        ['no usable revision', { revision: 'x' }],
        ['a revision out of range', { revision: -1 }],
        ['a newer schema', { schema: 3 }],
    ])('refuses a stored value with %s, nothing written', async (_n, extra) => {
        const { kv, store } = run(invalidAccess([ok('reader', 'r')], extra));
        await expect(store.removeClients(1, [{ index: 0, id: 'reader', entry: ok('reader', 'r') }])).rejects.toBeInstanceOf(Error);
        expect(kv.writes).toEqual([]);
    });

    it('refuses when machineClients is no list (any more), or nothing is stored, or nothing is to be removed', async () => {
        const a = run(invalidAccess([], { machineClients: { 0: ok('reader', 'r') } }));
        await expect(a.store.removeClients(1, [{ index: 0, id: 'reader', entry: ok('reader', 'r') }])).rejects.toBeInstanceOf(ConflictError);
        const b = new ExtensionStore(new MemoryKv({ access: [] }));
        await expect(b.removeClients(1, [{ index: 0, id: 'reader', entry: ok('reader', 'r') }])).rejects.toBeInstanceOf(ConflictError);
        await expect(a.store.removeClients(1, [])).rejects.toBeInstanceOf(InvalidValueError);
        expect(a.kv.writes).toEqual([]);
    });
});

describe('bidi controls in client names (M1)', () => {
    const key = (c: string) => btoa(c.repeat(32));
    const named = (id: string, name: string, c: string) => ({ id, name, publicKeys: [key(c)], permissions: [], createdAt: '2026-01-01' });

    it.each(['\u202E', '\u202A', '\u2066', '\u2069'])('a new or changed name with %j is refused on save, nothing written', async (ch) => {
        const kv = new MemoryKv({ access: [JSON.stringify({ ...access, machineClients: [named('old', 'Alt', 'a')] })] });
        const store = new ExtensionStore(kv);
        await expect(store.saveAccess({ ...access, machineClients: [named('old', `Alt${ch}`, 'a') as never] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        await expect(store.saveAccess({ ...access, machineClients: [named('old', 'Alt', 'a') as never, named('new', `x${ch}y`, 'b') as never] }, 1)).rejects.toBeInstanceOf(InvalidValueError);
        expect(kv.writes).toEqual([]);
    });

    it('a stored name with one is read (parity with the backend) and kept unchanged on a save', async () => {
        const odd = named('old', 'A\u202Eb', 'a');
        const kv = new MemoryKv({ access: [JSON.stringify({ ...access, machineClients: [odd] })] });
        const store = new ExtensionStore(kv);
        const r = await store.readAccess();
        expect(r.state === 'ok' && r.value.machineClients.map((c) => c.name)).toEqual(['A\u202Eb']);
        await store.saveAccess({ ...access, machineClients: [odd as never, named('new', 'Neu', 'b') as never] }, 1);
        expect((JSON.parse(kv.writes[0]!.value!) as { machineClients: unknown[] }).machineClients[0]).toEqual(odd);
    });
});
