import { describe, expect, it } from 'vitest';
import { MemoryKv } from '../store/memory-kv';
import { ExtensionStore, type StoredValue } from '../store/repository';
import { describeDuplicates, shownText } from './duplicates';

const settings = { schema: 2, revision: 3, requirePasswordForPasswordChange: true, allowCustomPassword: false, passwordLength: 16, backendUrl: 'https://pw.example', oauthClientId: 'client-1' };
const group = (groupId: number) => ({ groupId, createdBySetup: true });
const access = { schema: 2, revision: 1, groups: { users: group(40), admins: group(41), service: group(42) }, machineClients: [] as unknown[] };
const key = (c: string) => btoa(c.repeat(32));
const reader = { id: 'reader', name: 'Reader', publicKeys: [key('r')], permissions: ['entries:read'], createdAt: '2026-01-01' };

async function values(category: 'settings' | 'access', ...list: unknown[]): Promise<StoredValue<unknown>[]> {
    const kv = new MemoryKv({ [category]: list.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))) });
    const store = new ExtensionStore(kv);
    const r = category === 'settings' ? await store.readSettings() : await store.readAccess();
    if (r.state !== 'duplicates') throw new Error('not duplicates');
    return r.values as StoredValue<unknown>[];
}

const field = (shown: ReturnType<typeof describeDuplicates>[number], name: string) => shown.fields.find((f) => f.name === name);

describe('shownText: plain text, cut, marked for isolation', () => {
    it.each([
        [undefined, { text: '–', isolate: false }],
        [16, { text: '16', isolate: false }],
        [true, { text: 'true', isolate: false }],
        ['abc', { text: 'abc', isolate: true }],
        [{ a: 1 }, { text: '{"a":1}', isolate: true }],
        [null, { text: 'null', isolate: true }],
    ])('%j', (value, expected) => {
        expect(shownText(value)).toEqual(expected);
    });

    it('cuts long texts to 120 characters with „…“', () => {
        expect(shownText('x'.repeat(121)).text).toBe(`${'x'.repeat(120)}…`);
        expect(shownText('x'.repeat(120)).text).toBe('x'.repeat(120));
        expect(shownText({ a: 'y'.repeat(200) }).text).toHaveLength(121);
    });
});

describe('describeDuplicates: settings', () => {
    it('shows each value with its id, revision, state and the fields that matter, marking those that differ', async () => {
        const shown = describeDuplicates('settings', await values('settings', settings, { ...settings, revision: 5, backendUrl: 'https://evil.example', future: 1 }));
        expect(shown.map((v) => [v.valueId, v.revision.text, v.state, v.keepable])).toEqual([
            [2, '5', 'ok', true],
            [1, '3', 'ok', true],
        ]);
        expect(shown[0]!.fields.map((f) => f.name)).toEqual(['backendUrl', 'oauthClientId', 'requirePasswordForPasswordChange', 'allowCustomPassword', 'passwordLength', 'texts']);
        expect(field(shown[0]!, 'backendUrl')).toMatchObject({ text: 'https://evil.example', isolate: true, differs: true });
        expect(field(shown[1]!, 'backendUrl')).toMatchObject({ text: 'https://pw.example', differs: true });
        expect(field(shown[0]!, 'passwordLength')).toMatchObject({ text: '16', differs: false });
        expect(shown[0]!.otherFields).toEqual({ text: 'future', isolate: true });
        expect(shown[1]!.otherFields).toBeUndefined();
    });

    it('names the host the browser really connects to, and invisible characters', async () => {
        const shown = describeDuplicates('settings', await values('settings', settings, { ...settings, backendUrl: 'https://pw.example%2eevil.com' }, { ...settings, backendUrl: 'https://p​w.example' }));
        expect(field(shown[1]!, 'backendUrl')).toMatchObject({ host: 'pw.example.evil.com' });
        expect(field(shown[2]!, 'backendUrl')?.host).toBeUndefined();
        expect(field(shown[0]!, 'backendUrl')?.invisible).toBe(true);
        expect(field(shown[1]!, 'backendUrl')?.invisible).toBeUndefined();
    });

    it('reads invalid, newer and broken values as far as possible; only keepable ones can be kept', async () => {
        const shown = describeDuplicates('settings', await values('settings', { ...settings, passwordLength: 5 }, { ...settings, schema: 3 }, '{nope', '"text"'));
        expect(shown.map((v) => [v.valueId, v.state, v.keepable, v.issues])).toEqual([
            [4, 'invalid', false, 1],
            [3, 'invalid', false, 1],
            [2, 'newer', false, 0],
            [1, 'invalid', true, 1],
        ]);
        expect(field(shown[3]!, 'passwordLength')?.text).toBe('5');
        expect(shown[1]!.fields.every((f) => f.text === '–')).toBe(true);
        expect(shown[1]!.revision.text).toBe('–');
    });

    it('cuts and isolates a hostile revision and other field names', async () => {
        const shown = describeDuplicates('settings', await values('settings', settings, { ...settings, revision: 'r'.repeat(300), ['n'.repeat(130)]: 1 }));
        expect(shown[0]!.revision).toEqual({ text: `${'r'.repeat(120)}…`, isolate: true });
        expect(shown[0]!.otherFields?.text).toBe(`${'n'.repeat(120)}…`);
    });
});

describe('describeDuplicates: access', () => {
    it('lists the clients the backend would enable with a value (the planted extra reader), and counts the disabled ones', async () => {
        const shown = describeDuplicates('access', await values('access', access, { ...access, machineClients: [reader, { id: 'x' }] }));
        expect(shown[0]!.clients).toEqual([{ id: 'reader', name: 'Reader', canRead: true, fingerprints: [expect.stringMatching(/^[A-Za-z0-9_-]{16}$/)] }]);
        expect(shown[0]!.disabledClients).toBe(1);
        expect(shown[1]!.clients).toEqual([]);
        expect(shown[1]!.disabledClients).toBe(0);
        expect(shown[0]!.fields.map((f) => [f.name, f.text, f.differs])).toEqual([
            ['groups.users', '40', false],
            ['groups.admins', '41', false],
            ['groups.service', '42', false],
        ]);
    });

    it('marks another admin group as different, and lists clients of an invalid value too; names and ids cut to 40', async () => {
        const long = { ...reader, id: 'a'.repeat(40), name: 'N'.repeat(60) };
        const invalid = { ...access, groups: { ...access.groups, admins: group(99), service: 'x' }, machineClients: [long] };
        const shown = describeDuplicates('access', await values('access', access, invalid));
        expect(shown[0]!.state).toBe('invalid');
        expect(field(shown[0]!, 'groups.admins')).toMatchObject({ text: '99', differs: true });
        expect(field(shown[0]!, 'groups.service')).toMatchObject({ text: 'x', isolate: true, differs: true });
        expect(shown[0]!.clients).toEqual([{ id: 'a'.repeat(40), name: `${'N'.repeat(40)}…`, canRead: true, fingerprints: [expect.any(String)] }]);
    });

    it('a group id stored as text differs from the same number', async () => {
        const shown = describeDuplicates('access', await values('access', access, { ...access, groups: { ...access.groups, admins: { groupId: '41', createdBySetup: true } } }));
        expect(field(shown[0]!, 'groups.admins')).toMatchObject({ text: '41', isolate: true, differs: true });
    });

    it('machineClients that is no list: no clients known, nothing enabled', async () => {
        const shown = describeDuplicates('access', await values('access', access, { ...access, machineClients: 'x' }));
        expect(shown[0]!.clients).toEqual([]);
        expect(shown[0]!.disabledClients).toBe(0);
    });
});
