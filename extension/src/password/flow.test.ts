import { describe, expect, it } from 'vitest';
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
            expect(result.reason).toBe('password.invalidCustom');
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
        expect(result).toEqual({ ok: false, reason: 'password.primaryRequired' });
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
        expect(result).toEqual({ ok: false, reason: 'password.customNotAllowed' });
    });

    it('is not ok in the overview and result steps', () => {
        expect(canSubmit({ step: 'overview' }, { password: valid, primaryPassword: 'x' }, settings(true, true)).ok).toBe(false);
        expect(canSubmit({ step: 'result' }, { password: valid, primaryPassword: 'x' }, settings(true, true)).ok).toBe(false);
    });

    it('checks the primary password before the custom one', () => {
        const result = canSubmit({ step: 'choose', mode: 'custom' }, { password: 'bad', primaryPassword: '' }, settings(true, true));
        expect(result.reason).toBe('password.primaryRequired');
    });
});
