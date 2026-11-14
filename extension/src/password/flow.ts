import { checkPassword } from './rules';

/** The settings the flow depends on (the fields of the settings document it uses). */
export interface FlowSettings {
    allowCustomPassword: boolean;
    requirePasswordForPasswordChange: boolean;
    passwordLength: number;
}

export type FlowState = { step: 'overview' } | { step: 'choose'; mode: 'generate' | 'custom' } | { step: 'result'; generated?: string };

export interface FlowInput {
    /** The custom password as typed (never trimmed). */
    password: string;
    /** The ChurchTools password as typed (never trimmed). */
    primaryPassword: string;
}

/** Spec 4.2: nothing to choose and nothing to confirm means the password can be generated right away. */
export function nextAfterOverview(settings: Pick<FlowSettings, 'allowCustomPassword' | 'requirePasswordForPasswordChange'>): 'choose' | 'generate-now' {
    return !settings.allowCustomPassword && !settings.requirePasswordForPasswordChange ? 'generate-now' : 'choose';
}

/** Whether the form may be sent; if not, `reason` is an i18n key. The backend decides again. */
export function canSubmit(state: FlowState, input: FlowInput, settings: FlowSettings): { ok: boolean; reason?: string } {
    if (state.step !== 'choose') return { ok: false, reason: 'password.notReady' };
    if (settings.requirePasswordForPasswordChange && input.primaryPassword === '') {
        return { ok: false, reason: 'password.primaryRequired' };
    }
    if (state.mode === 'custom') {
        if (!settings.allowCustomPassword) return { ok: false, reason: 'password.customNotAllowed' };
        if (checkPassword(input.password, settings.passwordLength).length > 0) return { ok: false, reason: 'password.invalidCustom' };
    }
    return { ok: true };
}
