import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupPageUrl, parsePublicKey, slugFromName, todayIso, validateClients } from './machine-clients';

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
        for (const c of cases) {
            if ('client' in c) {
                expect(validateClients([c.client]).flatMap((i) => i.reasons), c.name).toEqual(c.reasons);
            } else if ('clients' in c) {
                const expected = c.reasons.flatMap((reasons, index) => (reasons.length > 0 ? [{ index, reasons }] : []));
                expect(validateClients(c.clients).map(({ index, reasons }) => ({ index, reasons })), c.name).toEqual(expected);
            }
        }
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
