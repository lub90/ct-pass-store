import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { describeEntry, draftClient, finalizeClient, groupPageUrl, isolate, keyFingerprint, newlyEnabled, parsePublicKey, sha256, slugFromName, todayIso, validateClients } from './machine-clients';

// The parity fixture shared with the backend (spec backend 3.2): the form checks with the same rules.
interface Single { name: string; client: unknown; valid: boolean; reasons: string[] }
interface Multi { name: string; clients: unknown[]; enabled: string[]; reasons: string[][] }
type Case = Single | Multi | { name: string; machineClients: unknown };
const cases = JSON.parse(readFileSync(resolve(process.cwd(), '../shared/access-client-cases.json'), 'utf8')) as Case[];

/** 32 bytes `n, n, …` as standard base64 with padding. */
const key = (n: number, length = 32): string => Buffer.from(new Uint8Array(length).fill(n)).toString('base64');
const client = (id: string, keys: string[], extra: Record<string, unknown> = {}) => ({ id, name: id, publicKeys: keys, permissions: ['entries:read'], createdAt: '2026-11-14', ...extra });

describe('slugFromName', () => {
    it.each([
        ['WLAN RADIUS', 'wlan-radius'],
        ['Ü', ''],
        ['ab', ''],
        ['abc', 'abc'],
        ['Größe Übung', 'groesse-uebung'],
        ['ÄÖÜ äöü ß', 'aeoeue-aeoeue-ss'],
        ['Café Crème', 'cafe-creme'],
        ['  --Ct  Radius!!  ', 'ct-radius'],
        ['a_b.c/d', 'a-b-c-d'],
        ['Раdius', 'dius'],
        ['🙂🙂🙂', ''],
        ['x'.repeat(50), 'x'.repeat(40)],
        // Cut to 40, then no hyphen left at the end.
        [`${'a'.repeat(39)} b`, 'a'.repeat(39)],
    ])('%j → %j', (name, slug) => {
        expect(slugFromName(name)).toBe(slug);
    });

    it('always gives an id the backend accepts, or nothing', () => {
        for (const name of ['WLAN RADIUS', 'x'.repeat(80), '-a-', 'Ä-Ö', '1 2 3', 'İstanbul', 'ﬁle']) {
            const slug = slugFromName(name);
            expect(slug === '' || /^[a-z0-9-]{3,40}$/.test(slug)).toBe(true);
        }
    });
});

describe('parsePublicKey', () => {
    it('accepts 32 bytes as base64 (padded) and base64url (with or without padding) and gives the bytes', () => {
        const bytes = new Uint8Array(32).map((_, i) => (i % 3 === 0 ? 0xff : 0xfb - i));
        const std = Buffer.from(bytes).toString('base64');
        const url = Buffer.from(bytes).toString('base64url');
        expect(std).toMatch(/[+/]/);
        for (const text of [std, url, `${url}=`]) expect(parsePublicKey(text)).toEqual(bytes);
    });

    it('rejects 31 and 33 bytes', () => {
        expect(parsePublicKey(key(1, 31))).toBeNull();
        expect(parsePublicKey(key(1, 33))).toBeNull();
        expect(parsePublicKey(Buffer.from(new Uint8Array(31).fill(1)).toString('base64url'))).toBeNull();
        expect(parsePublicKey(Buffer.from(new Uint8Array(33).fill(1)).toString('base64url'))).toBeNull();
    });

    it('trims exactly what the backend trims, and nothing inside', () => {
        expect(parsePublicKey(` \t${key(2)}\n`)).toEqual(new Uint8Array(32).fill(2));
        expect(parsePublicKey(`\u00A0${key(2)}`)).toBeNull();
        expect(parsePublicKey(`${key(2).slice(0, 20)} ${key(2).slice(20)}`)).toBeNull();
    });

    it('rejects empty text, mixed alphabets and non-canonical trailing bits', () => {
        expect(parsePublicKey('')).toBeNull();
        const url = Buffer.from(new Uint8Array(32).fill(0xfb)).toString('base64url');
        expect(url).toMatch(/[-_]/);
        expect(parsePublicKey(`${url.slice(0, 42).replace(/-/g, '+')}_=`)).toBeNull();
        // 'B' as the last character sets bits beyond the 32 bytes.
        expect(parsePublicKey(`${'A'.repeat(42)}B=`)).toBeNull();
        expect(parsePublicKey(`${'A'.repeat(42)}A=`)).toEqual(new Uint8Array(32));
    });

    it('agrees with the shared fixture on every key of the single-entry cases', () => {
        let checked = 0;
        for (const c of cases) {
            if (!('client' in c)) continue;
            const keys = (c.client as { publicKeys?: unknown } | null)?.publicKeys;
            if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === 'string')) continue;
            expect(keys.every((k: string) => parsePublicKey(k) !== null), c.name).toBe(!c.reasons.includes('invalid-key'));
            checked++;
        }
        expect(checked).toBeGreaterThan(10);
    });
});

describe('validateClients (backend spec 3.2)', () => {
    it('is empty for distinct clients', () => {
        expect(validateClients([client('one', [key(1)]), client('two', [key(2), key(3)])])).toEqual([]);
    });

    it('flags a duplicate id on both entries', () => {
        expect(validateClients([client('same', [key(1)]), client('other', [key(2)]), client('same', [key(3)])])).toEqual([
            { index: 0, id: 'same', reasons: ['duplicate-id'] },
            { index: 2, id: 'same', reasons: ['duplicate-id'] },
        ]);
    });

    it('flags a shared key on both clients, also when one writes it as base64url', () => {
        const bytes = new Uint8Array(32).fill(0xfb);
        const issues = validateClients([client('one', [Buffer.from(bytes).toString('base64')]), client('two', [key(5), Buffer.from(bytes).toString('base64url')])]);
        expect(issues).toEqual([
            { index: 0, id: 'one', reasons: ['shared-key'] },
            { index: 1, id: 'two', reasons: ['shared-key'] },
        ]);
    });

    it('flags empty keys', () => {
        expect(validateClients([client('none', [])])).toEqual([{ index: 0, id: 'none', reasons: ['no-keys'] }]);
    });

    it('agrees with the shared fixture (single and multi-entry cases)', () => {
        const checked = { single: 0, multi: 0 };
        for (const c of cases) {
            if ('client' in c) {
                expect(validateClients([c.client]).flatMap((i) => i.reasons), c.name).toEqual(c.reasons);
                checked.single++;
            } else if ('clients' in c) {
                const expected = c.reasons.flatMap((reasons, index) => (reasons.length > 0 ? [{ index, reasons }] : []));
                expect(validateClients(c.clients).map(({ index, reasons }) => ({ index, reasons })), c.name).toEqual(expected);
                checked.multi++;
            }
        }
        expect(checked.single).toBeGreaterThan(40);
        expect(checked.multi).toBeGreaterThan(5);
    });
});

describe('todayIso', () => {
    it('is the local calendar date as YYYY-MM-DD (the admin’s „today“)', () => {
        expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
        expect(todayIso(new Date(2026, 11, 31, 23, 55))).toBe('2026-12-31');
        expect(todayIso(new Date(987, 2, 9, 12))).toBe('0987-03-09');
    });
});

describe('groupPageUrl', () => {
    it('is the group page of the configured ChurchTools, built from the base and the id only', () => {
        expect(groupPageUrl('https://ct.example', 41)).toBe('https://ct.example/groups/41/dashboard');
        expect(groupPageUrl('https://ct.example/', 41)).toBe('https://ct.example/groups/41/dashboard');
        expect(groupPageUrl('https://ct.example/sub/', 7)).toBe('https://ct.example/sub/groups/7/dashboard');
    });

    it('is null for anything but an http(s) base without credentials, query or fragment, or a bad id', () => {
        for (const base of ['javascript:alert(1)', 'data:text/html,x', 'ftp://ct.example', 'https://u:p@ct.example', 'https://ct.example/?q=1', 'https://ct.example/#x', '', 'not a url']) {
            expect(groupPageUrl(base, 41), base).toBeNull();
        }
        for (const id of [0, -1, 1.5, Number.NaN, 2 ** 53]) expect(groupPageUrl('https://ct.example', id), String(id)).toBeNull();
    });
});

describe('sha256 and keyFingerprint (spec 4.7)', () => {
    it.each([0, 1, 3, 32, 55, 56, 63, 64, 65, 200])('sha256 of %i bytes matches node:crypto', (n) => {
        const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
        expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('is the first 16 characters of base64url(SHA-256(the 32 key bytes)), whatever encoding was pasted', () => {
        const bytes = new Uint8Array(32).map((_, i) => 0xff - i);
        const expected = createHash('sha256').update(bytes).digest('base64url').slice(0, 16);
        expect(keyFingerprint(bytes)).toBe(expected);
        expect(keyFingerprint(parsePublicKey(Buffer.from(bytes).toString('base64'))!)).toBe(expected);
        expect(keyFingerprint(parsePublicKey(Buffer.from(bytes).toString('base64url'))!)).toBe(expected);
        expect(expected).toMatch(/^[A-Za-z0-9_-]{16}$/);
    });

    it('uses the base64url alphabet (- and _), like node’s base64url, over many keys (N3)', () => {
        const prints = Array.from({ length: 64 }, (_, n) => {
            const bytes = new Uint8Array(32).fill(n);
            const print = keyFingerprint(bytes);
            expect(print, String(n)).toBe(createHash('sha256').update(bytes).digest('base64url').slice(0, 16));
            return print;
        });
        expect(prints.some((p) => /[-_]/.test(p))).toBe(true);
        expect(prints.every((p) => !/[+/=]/.test(p))).toBe(true);
    });
});

describe('describeEntry: what the page shows of a stored entry (any shape)', () => {
    it('reads name, permission, createdAt, createdBy and one fingerprint per key, without checking', () => {
        const d = describeEntry({ name: ' Rad ', publicKeys: [key(1), 'nope', 5], permissions: ['entries:read', '*'], createdAt: '1.1.2026', createdBy: 7 });
        expect(d).toEqual({ name: ' Rad ', canRead: true, createdAt: '1.1.2026', createdAtIsDate: false, createdBy: 7, fingerprints: [keyFingerprint(new Uint8Array(32).fill(1)), null, null] });
    });

    it.each([
        ['a string', 'x'],
        ['zero', 0],
        ['negative', -1],
        ['a fraction', 1.5],
        ['an object', {}],
        ['null', null],
    ])('ignores a createdBy that is %s', (_n, createdBy) => {
        expect(describeEntry({ createdBy }).createdBy).toBeUndefined();
    });

    it.each([[['*']], [['entries:write']], [[]], [[1, null]]])('permissions %j don’t read (N2)', (permissions) => {
        expect(describeEntry({ permissions }).canRead).toBe(false);
    });

    it('cuts a long name and a createdAt that is no date to 60 characters; a date is kept as it is (S-N3)', () => {
        const d = describeEntry({ name: 'n'.repeat(5000), createdAt: `2026\u202E${'x'.repeat(100)}` });
        expect(d.name).toBe(`${'n'.repeat(60)}…`);
        expect(d.createdAt).toBe(`2026\u202E${'x'.repeat(55)}…`);
        expect(d.createdAtIsDate).toBe(false);
        expect(describeEntry({ createdAt: '2026-11-01' })).toMatchObject({ createdAt: '2026-11-01', createdAtIsDate: true });
        expect(describeEntry({ name: 'n'.repeat(60) }).name).toBe('n'.repeat(60));
    });

    it('gives nothing for non-objects and odd fields', () => {
        expect(describeEntry('text')).toEqual({ canRead: false, fingerprints: [] });
        expect(describeEntry({ name: 5, permissions: 'entries:read', publicKeys: { 0: key(1) }, createdAt: 3 })).toEqual({ canRead: false, fingerprints: [] });
    });
});

describe('newlyEnabled: entries a removal would turn on (F2)', () => {
    const c = (id: string, k: number, extra: Record<string, unknown> = {}) => client(id, [key(k)], extra);

    it('removing one of two entries with the same id enables the other', () => {
        expect(newlyEnabled([c('same', 1), c('same', 2), c('other', 3)], [0])).toEqual([1]);
        expect(newlyEnabled([c('same', 1), c('same', 2), c('other', 3)], [1])).toEqual([0]);
    });

    it('removing one of two clients sharing a key enables the other', () => {
        expect(newlyEnabled([c('one', 1), c('two', 1)], [1])).toEqual([0]);
    });

    it('removing both, or an entry nothing depends on, enables nothing', () => {
        expect(newlyEnabled([c('same', 1), c('same', 2)], [0, 1])).toEqual([]);
        expect(newlyEnabled([c('one', 1), c('two', 2), 'text'], [2])).toEqual([]);
        expect(newlyEnabled([c('same', 1), c('same', 2), c('same', 3)], [0])).toEqual([]);
    });
});

describe('isolate', () => {
    it('wraps a text in first-strong isolate and pop isolate (the text form of <bdi>)', () => {
        expect(isolate('a\u202Eb')).toBe('\u2068a\u202Eb\u2069');
    });
});

describe('draftClient and finalizeClient (the client form)', () => {
    it('a new client: empty fields, no permission, createdAt today (local) and createdBy the person', () => {
        expect(draftClient(7, new Date(2026, 0, 1, 23, 59))).toEqual({ id: '', name: '', publicKeys: [''], permissions: [], createdAt: '2026-01-01', createdBy: 7 });
    });

    it('leaves createdBy out without a person id (never null)', () => {
        const d = draftClient(null, new Date(2026, 0, 1));
        expect('createdBy' in d).toBe(false);
    });

    it('trims name and keys of the edited client only (PHP trim), every other entry stays as it is', () => {
        const other = client('other', [` ${key(1)} `], { name: ' Other ' });
        const edited = client('edit', [`\t${key(2)}\n`], { name: ' Neu ' });
        const value = { schema: 2, revision: 1, machineClients: [other, edited] };
        const out = finalizeClient(value as never, 1) as unknown as typeof value;
        expect(out.machineClients[0]).toBe(other);
        expect(out.machineClients[1]).toEqual({ ...edited, name: 'Neu', publicKeys: [key(2)] });
        expect(value.machineClients[1]!.name).toBe(' Neu ');
    });
});
