/**
 * Repairing an invalid stored `settings` value on „Passwortregeln“ (spec 4.4 „Stored problems“), without the page.
 * Valid fields stay as stored; broken rules get a safe value; the save uses the stored revision. `backendUrl` and
 * `oauthClientId` are never invented or dropped (E15): with either broken, there is no repair here.
 */
import { PASSWORD_LENGTH, SCHEMA_VERSION, type SettingsV2 } from '../model/schemas';
import type { InvalidRead } from './useSettingsForm';

/** `version`: no schema-2 value with a usable revision; `backend`: `backendUrl` or `oauthClientId` is broken. */
export type NoRepair = 'version' | 'backend';

/** The length a broken stored `passwordLength` repairs to: the maximum above it, otherwise 16. */
function safeLength(stored: unknown): number {
    return typeof stored === 'number' && stored > PASSWORD_LENGTH.max ? PASSWORD_LENGTH.max : 16;
}

export function settingsRepair(read: InvalidRead<SettingsV2>): { value: SettingsV2 } | { reason: NoRepair } {
    const r = read.repair;
    if (!r || read.revision === undefined || read.revision < 0) return { reason: 'version' };
    if (r.broken.includes('backendUrl') || r.broken.includes('oauthClientId')) return { reason: 'backend' };
    return {
        value: {
            requirePasswordForPasswordChange: true,
            allowCustomPassword: false,
            passwordLength: safeLength(r.brokenValues.passwordLength),
            ...r.kept,
            schema: SCHEMA_VERSION,
            revision: read.revision,
        },
    };
}
