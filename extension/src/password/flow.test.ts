import { describe, expect, it } from 'vitest';
import de from '@/i18n/de';
import en from '@/i18n/en';
import { canSubmit, nextAfterOverview, type FlowSettings } from './flow';

const settings = (allowCustomPassword: boolean, requirePasswordForPasswordChange: boolean, passwordLength = 12): FlowSettings => ({
    allowCustomPassword,
    requirePasswordForPasswordChange,
    passwordLength,
});

describe('nextAfterOverview', () => {
    it('generates right away only without custom passwords and without a primary password', () => {
        expect(nextAfterOverview(settings(false, false))).toBe('generate-now');
    });
    it.each([
        [true, true],
        [true, false],
        [false, true],
    ])('goes to the choose step for allowCustomPassword=%s, requirePassword=%s', (custom, require) => {
        expect(nextAfterOverview(settings(custom, require))).toBe('choose');
    });
});

describe('canSubmit', () => {
    const valid = 'Abcdefgh12!?';

    it('is not ok for custom without a valid password', () => {
        for (const password of ['', 'short1!', 'Abcdefgh12!? ', 'Abcdefghijkl1']) {
            const result = canSubmit({ step: 'choose', mode: 'custom' }, { password, primaryPassword: 'x' }, settings(true, true));
            expect(result.ok, password).toBe(false);
            expect(result.reason).toBe('problems.passwordInvalid');
        }
    });

    it('is ok for a valid custom password', () => {
        expect(canSubmit({ step: 'choose', mode: 'custom' }, { password: valid, primaryPassword: 'x' }, settings(true, true))).toEqual({ ok: true });
        expect(canSubmit({ step: 'choose', mode: 'custom' }, { password: valid, primaryPassword: '' }, settings(true, false))).toEqual({ ok: true });
    });

    it('checks the custom password against passwordLength', () => {
        const result = canSubmit({ step: 'choose', mode: 'custom' }, { password: valid, primaryPassword: '' }, settings(true, false, 13));
        expect(result.ok).toBe(false);
    });

    it('is not ok for a required but empty primary password', () => {
        const result = canSubmit({ step: 'choose', mode: 'generate' }, { password: '', primaryPassword: '' }, settings(true, true));
        expect(result).toEqual({ ok: false, reason: 'problems.primaryPasswordRequired' });
    });

    it('does not trim the primary password', () => {
        expect(canSubmit({ step: 'choose', mode: 'generate' }, { password: '', primaryPassword: ' ' }, settings(true, true)).ok).toBe(true);
    });

    it('needs no primary password when the setting does not require it', () => {
        expect(canSubmit({ step: 'choose', mode: 'generate' }, { password: '', primaryPassword: '' }, settings(true, false)).ok).toBe(true);
    });

    it('is ok for generate mode with the primary password', () => {
        expect(canSubmit({ step: 'choose', mode: 'generate' }, { password: '', primaryPassword: 'x' }, settings(true, true))).toEqual({ ok: true });
    });

    it('ignores a typed password in generate mode', () => {
        expect(canSubmit({ step: 'choose', mode: 'generate' }, { password: 'bad', primaryPassword: 'x' }, settings(true, true)).ok).toBe(true);
    });

    it('refuses custom mode when custom passwords are not allowed', () => {
        const result = canSubmit({ step: 'choose', mode: 'custom' }, { password: valid, primaryPassword: 'x' }, settings(false, true));
        expect(result).toEqual({ ok: false, reason: 'problems.customPasswordNotAllowed' });
    });

    it('checks the primary password before the custom one', () => {
        const result = canSubmit({ step: 'choose', mode: 'custom' }, { password: 'bad', primaryPassword: '' }, settings(true, true));
        expect(result.reason).toBe('problems.primaryPasswordRequired');
    });
});

describe('canSubmit in generate mode', () => {
    const state = { step: 'choose', mode: 'generate' } as const;
    it.each([
        [true, true],
        [true, false],
        [false, true],
        [false, false],
    ])('allowCustom=%s, requirePrimary=%s', (custom, require) => {
        const s = settings(custom, require);
        if (require) {
            expect(canSubmit(state, { password: '', primaryPassword: '' }, s)).toEqual({ ok: false, reason: 'problems.primaryPasswordRequired' });
        } else {
            expect(canSubmit(state, { password: '', primaryPassword: '' }, s)).toEqual({ ok: true });
        }
        expect(canSubmit(state, { password: '', primaryPassword: 'x' }, s)).toEqual({ ok: true });
    });
});

describe('canSubmit with passwordLength 64', () => {
    const state = { step: 'choose', mode: 'custom' } as const;
    const pw = (n: number) => `Aa1!${'x'.repeat(n - 4)}`;
    it('refuses 63 characters and accepts 64', () => {
        expect(canSubmit(state, { password: pw(63), primaryPassword: '' }, settings(true, false, 64))).toEqual({ ok: false, reason: 'problems.passwordInvalid' });
        expect(canSubmit(state, { password: pw(64), primaryPassword: '' }, settings(true, false, 64))).toEqual({ ok: true });
    });
});

describe('canSubmit reasons', () => {
    it('exist in de and en', () => {
        const reasons = new Set<string>();
        const inputs = [
            { password: '', primaryPassword: '' },
            { password: 'bad', primaryPassword: 'x' },
            { password: 'Abcdefgh12!?', primaryPassword: 'x' },
        ];
        const states = [{ step: 'choose', mode: 'generate' }, { step: 'choose', mode: 'custom' }] as const;
        for (const custom of [true, false]) {
            for (const require of [true, false]) {
                for (const st of states) {
                    for (const input of inputs) {
                        const r = canSubmit(st, input, settings(custom, require)).reason;
                        if (r) reasons.add(r);
                    }
                }
            }
        }
        expect([...reasons].sort()).toEqual(['problems.customPasswordNotAllowed', 'problems.passwordInvalid', 'problems.primaryPasswordRequired']);
        for (const messages of [de, en]) {
            for (const reason of reasons) {
                const value = reason.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
                expect(typeof value, reason).toBe('string');
            }
        }
    });
});
