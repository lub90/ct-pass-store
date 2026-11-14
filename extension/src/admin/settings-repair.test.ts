import { describe, expect, it } from 'vitest';
import type { SettingsV2 } from '../model/schemas';
import type { InvalidRead } from './useSettingsForm';
import { settingsRepair } from './settings-repair';

const read = (o: Partial<InvalidRead<SettingsV2>>): InvalidRead<SettingsV2> => ({ state: 'invalid', issues: ['x'], ...o });
const repair = (kept: Partial<SettingsV2>, brokenValues: Record<string, unknown>) => ({ kept, broken: Object.keys(brokenValues), brokenValues });

describe('settingsRepair (spec 4.4 „Stored problems“)', () => {
    it('keeps valid fields as stored (also when they differ from the safe values) and sets safe values for broken rules', () => {
        const r = settingsRepair(read({ revision: 7, repair: repair({ requirePasswordForPasswordChange: false, allowCustomPassword: true, backendUrl: 'https://b.example', oauthClientId: 'c' }, { passwordLength: 'x' }) }));
        expect(r).toStrictEqual({
            value: { schema: 2, revision: 7, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16, backendUrl: 'https://b.example', oauthClientId: 'c' },
        });
    });
    it('broken rules: confirmation on, custom passwords off, length 16', () => {
        const r = settingsRepair(read({ revision: 1, repair: repair({}, { requirePasswordForPasswordChange: 'x', allowCustomPassword: 'x', passwordLength: 5 }) }));
        expect(r).toStrictEqual({ value: { schema: 2, revision: 1, requirePasswordForPasswordChange: true, allowCustomPassword: false, passwordLength: 16 } });
    });
    it.each([
        [65, 64],
        [1000, 64],
        [64.5, 64],
        [11, 16],
        [12.5, 16],
        ['99', 16],
        [null, 16],
    ])('a stored passwordLength of %j repairs to %i', (stored, length) => {
        const r = settingsRepair(read({ revision: 1, repair: repair({ requirePasswordForPasswordChange: true, allowCustomPassword: false }, { passwordLength: stored }) }));
        expect('value' in r && r.value.passwordLength).toBe(length);
    });
    it.each([
        ['backendUrl', { backendUrl: 'http://b.example' }],
        ['oauthClientId', { oauthClientId: '' }],
    ])('no repair when %s is broken (these pages never write it)', (_n, broken) => {
        expect(settingsRepair(read({ revision: 1, repair: repair({}, { passwordLength: 99, ...broken }) }))).toStrictEqual({ reason: 'backend' });
    });
    it('no repair without the store’s repair info or a usable revision', () => {
        expect(settingsRepair(read({}))).toStrictEqual({ reason: 'version' });
        expect(settingsRepair(read({ revision: 3 }))).toStrictEqual({ reason: 'version' });
        expect(settingsRepair(read({ repair: repair({}, { passwordLength: 99 }) }))).toStrictEqual({ reason: 'version' });
        expect(settingsRepair(read({ revision: -1, repair: repair({}, { passwordLength: 99 }) }))).toStrictEqual({ reason: 'version' });
    });
});
