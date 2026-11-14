import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AccessSchema, MachineClientSchema, SettingsSchema } from './schemas';

const key = (n: number, fill = 97) => btoa(String.fromCharCode(...new Uint8Array(n).fill(fill)));
const client = { id: 'ct-radius', name: 'Radius', publicKeys: [key(32)], permissions: ['entries:read'], createdAt: '2026-01-01' };
const settings = { schema: 2, revision: 1, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16, backendUrl: 'https://b.example' };
const g = { groupId: 1, createdBySetup: false };
const access = { schema: 2, revision: 1, groups: { users: g, admins: g, service: g }, machineClients: [client] };

const table = <T>(schema: v.GenericSchema, base: T, cases: [string, Partial<Record<string, unknown>>, boolean][]) =>
    it.each(cases)('%s', (_name, patch, accepted) => {
        expect(v.safeParse(schema, { ...base, ...patch }).success).toBe(accepted);
    });

describe('public keys', () => {
    const ok = (k: string) => v.safeParse(MachineClientSchema, { ...client, publicKeys: [k] }).success;
    it.each([
        ['32 bytes', key(32), true],
        ['33 bytes', key(33), false],
        ['31 bytes', key(31), false],
        ['0 bytes', '', false],
        ['newline inside', `${key(32).slice(0, 10)}\n${key(32).slice(10)}`, false],
        ['space inside', `${key(32).slice(0, 10)} ${key(32).slice(10)}`, false],
        ['surrounding whitespace is rejected on write (the reader trims it)', `${key(32)}\n`, false],
        ['too much padding', `${key(32)}==`, false],
        ['unpadded standard base64 with + or / (not canonical)', key(32, 251).replace(/=+$/, ''), false],
        ['base64url without padding', key(32, 251).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), true],
    ])('%s', (_n, k, accepted) => expect(ok(k)).toBe(accepted));
    it('rejects an empty key list and a non-string key', () => {
        expect(v.safeParse(MachineClientSchema, { ...client, publicKeys: [] }).success).toBe(false);
        expect(v.safeParse(MachineClientSchema, { ...client, publicKeys: [5] }).success).toBe(false);
    });
});

describe('client id and fields', () => {
    table(MachineClientSchema, client, [
        ['id length 2 rejected', { id: 'ab' }, false],
        ['id length 3 accepted', { id: 'abc' }, true],
        ['id length 40 accepted', { id: 'a'.repeat(40) }, true],
        ['id length 41 rejected', { id: 'a'.repeat(41) }, false],
        ['uppercase id rejected', { id: 'Abc' }, false],
        ['Cyrillic id rejected', { id: 'ааа' }, false],
        ['trailing newline in id rejected', { id: 'abc\n' }, false],
        ['non-string id rejected', { id: 123 }, false],
        ['non-string name rejected', { name: 5 }, false],
        ['non-string createdAt rejected', { createdAt: 5 }, false],
        ['createdAt not a date', { createdAt: '2026-02-30' }, false],
        ['createdAt with time', { createdAt: '2026-01-01T00:00:00Z' }, false],
        ['whitespace-only name', { name: ' \t' }, false],
        ['unknown permission rejected here', { permissions: ['*'] }, false],
    ]);
});

describe('settings (mirror of backend 3.2)', () => {
    table(SettingsSchema, settings, [
        ['passwordLength 12', { passwordLength: 12 }, true],
        ['passwordLength 64', { passwordLength: 64 }, true],
        ['passwordLength 11', { passwordLength: 11 }, false],
        ['passwordLength 65', { passwordLength: 65 }, false],
        ['passwordLength 12.5', { passwordLength: 12.5 }, false],
        ['passwordLength "16"', { passwordLength: '16' }, false],
        ['require "true"', { requirePasswordForPasswordChange: 'true' }, false],
        ['require 0', { requirePasswordForPasswordChange: 0 }, false],
        ['require 1', { requirePasswordForPasswordChange: 1 }, false],
        ['require null', { requirePasswordForPasswordChange: null }, false],
        ['allowCustomPassword "true"', { allowCustomPassword: 'true' }, false],
        ['allowCustomPassword null', { allowCustomPassword: null }, false],
        ['revision 1.5', { revision: 1.5 }, false],
        ['revision -1', { revision: -1 }, false],
        ['revision MAX_SAFE_INTEGER - 1', { revision: Number.MAX_SAFE_INTEGER - 1 }, true],
        ['revision MAX_SAFE_INTEGER', { revision: Number.MAX_SAFE_INTEGER }, false],
        ['revision 2^60', { revision: 2 ** 60 }, false],
        ['title with a bidi override', { texts: { de: { title: 'abc\u202Edef' } } }, false],
        ['intro with an isolate', { texts: { en: { intro: '\u2066x\u2069' } } }, false],
        ['title with a zero-width space', { texts: { de: { title: 'a\u200Bb' } } }, true],
        ['empty oauthClientId', { oauthClientId: '' }, false],
        ['oauthClientId set', { oauthClientId: 'abc' }, true],
        ['https url', { backendUrl: 'https://b.example/api' }, true],
        ['credentials user only', { backendUrl: 'https://u@b.example' }, false],
        ['credentials user and password', { backendUrl: 'https://u:p@b.example' }, false],
        ['empty query', { backendUrl: 'https://b.example?' }, false],
        ['empty fragment', { backendUrl: 'https://b.example#' }, false],
        ['leading space', { backendUrl: ' https://b.example' }, false],
        ['trailing space', { backendUrl: 'https://b.example ' }, false],
        ['inner space', { backendUrl: 'https://b .example' }, false],
        ['javascript:', { backendUrl: 'javascript:alert(1)' }, false],
        ['uppercase scheme (backend compares case-sensitively)', { backendUrl: 'HTTPS://b.example' }, false],
        ['http', { backendUrl: 'http://b.example' }, false],
        // Parity with the backend's parse_url check: an empty user or password still counts as credentials, and a
        // URL needs a host (WHATWG would read `https:///x` as host `x`).
        ['empty credentials', { backendUrl: 'https://:@b.example' }, false],
        ['empty user', { backendUrl: 'https://@b.example' }, false],
        ['no host', { backendUrl: 'https:///b.example' }, false],
        ['backslash', { backendUrl: 'https://b.example\\@evil.example' }, false],
        ['tab', { backendUrl: 'https://b.example\t' }, false],
        ['port', { backendUrl: 'https://b.example:8443/api' }, true],
        ['wrong schema 1', { schema: 1 }, false],
        ['wrong schema "2"', { schema: '2' }, false],
    ]);
    const texts = (lang: 'de' | 'en', field: 'title' | 'intro', n: number) => ({ texts: { [lang]: { [field]: 'x'.repeat(n) } } });
    for (const lang of ['de', 'en'] as const) {
        table(SettingsSchema, settings, [
            [`${lang} title 60`, texts(lang, 'title', 60), true],
            [`${lang} title 61`, texts(lang, 'title', 61), false],
            [`${lang} intro 300`, texts(lang, 'intro', 300), true],
            [`${lang} intro 301`, texts(lang, 'intro', 301), false],
        ]);
    }
    table(SettingsSchema, settings, [
        ['texts array rejected', { texts: [] }, false],
        ['texts number rejected', { texts: 3 }, false],
    ]);
});

describe('access', () => {
    table(AccessSchema, access, [
        ['groupId "12"', { groups: { users: { groupId: '12', createdBySetup: true }, admins: g, service: g } }, false],
        ['groupId -1', { groups: { users: { groupId: -1, createdBySetup: true }, admins: g, service: g } }, false],
        ['groupId 0', { groups: { users: { groupId: 0, createdBySetup: true }, admins: g, service: g } }, false],
        ['groupId null', { groups: { users: { groupId: null, createdBySetup: true }, admins: g, service: g } }, false],
        ['groupId 1.5', { groups: { users: { groupId: 1.5, createdBySetup: true }, admins: g, service: g } }, false],
        ['createdBySetup "true"', { groups: { users: { groupId: 1, createdBySetup: 'true' }, admins: g, service: g } }, false],
        ['createdBySetup missing', { groups: { users: { groupId: 1 }, admins: g, service: g } }, false],
        ['missing service group', { groups: { users: g, admins: g } }, false],
        ['valid', {}, true],
    ]);
});
