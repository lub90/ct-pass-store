import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import type { PageTextsInput } from '@/i18n/custom-texts';
import { AccessSchema, MachineClientSchema, SettingsSchema, type SettingsTexts } from './schemas';

const key32 = btoa('a'.repeat(32));
const client = { id: 'ct-radius', name: 'Radius', publicKeys: [key32], permissions: ['entries:read'], createdAt: '2026-01-01T00:00:00Z' };

describe('schemas', () => {
    it('SettingsTexts is assignable to PageTextsInput', () => {
        const texts: SettingsTexts = { de: { title: 'a' } };
        const input: PageTextsInput = texts;
        expect(input).toBe(texts);
    });

    it('accepts 32-byte keys as base64 and base64url, rejects others', () => {
        const url = btoa(String.fromCharCode(...new Uint8Array(32).fill(251))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const ok = (k: string) => v.safeParse(MachineClientSchema, { ...client, publicKeys: [k] }).success;
        expect(ok(key32)).toBe(true);
        expect(ok(url)).toBe(true);
        expect(ok(btoa('a'.repeat(31)))).toBe(false);
        expect(ok('not base64!')).toBe(false);
        expect(v.safeParse(MachineClientSchema, { ...client, publicKeys: [] }).success).toBe(false);
    });

    it('checks the client id, permissions and groups', () => {
        expect(v.safeParse(MachineClientSchema, { ...client, id: 'AB' }).success).toBe(false);
        expect(v.safeParse(MachineClientSchema, { ...client, permissions: ['entries:write'] }).success).toBe(false);
        const g = { groupId: 1, createdBySetup: false };
        const access = { schema: 2, revision: 1, groups: { users: g, admins: g, service: g }, machineClients: [client] };
        expect(v.safeParse(AccessSchema, access).success).toBe(true);
        expect(v.safeParse(AccessSchema, { ...access, groups: { ...access.groups, admins: { groupId: 0, createdBySetup: true } } }).success).toBe(false);
    });

    it('rejects non-string texts', () => {
        const base = { schema: 2, revision: 1, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16, backendUrl: '' };
        expect(v.safeParse(SettingsSchema, { ...base, texts: { de: { title: 5 } } }).success).toBe(false);
        expect(v.safeParse(SettingsSchema, { ...base, texts: { de: { title: 'ok' } } }).success).toBe(true);
    });
});
