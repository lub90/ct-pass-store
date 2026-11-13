import * as v from 'valibot';

/** Layout version of the data this code reads and writes. */
export const SCHEMA_VERSION = 2;

function decodesTo32Bytes(s: string): boolean {
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return false;
    const std = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (std.length % 4 === 1) return false;
    try {
        return atob(std.padEnd(Math.ceil(std.length / 4) * 4, '=')).length === 32;
    } catch {
        return false;
    }
}

const PageText = v.looseObject({
    title: v.optional(v.pipe(v.string(), v.maxLength(60))),
    intro: v.optional(v.pipe(v.string(), v.maxLength(300))),
});

export const SettingsTextsSchema = v.looseObject({ de: v.optional(PageText), en: v.optional(PageText) });
export type SettingsTexts = v.InferOutput<typeof SettingsTextsSchema>;

const Revision = v.pipe(v.number(), v.integer(), v.minValue(0));

/** Unknown fields are allowed (and kept) by `looseObject`. */
export const SettingsSchema = v.looseObject({
    schema: v.literal(SCHEMA_VERSION),
    revision: Revision,
    requirePasswordForPasswordChange: v.boolean(),
    allowCustomPassword: v.boolean(),
    passwordLength: v.pipe(v.number(), v.integer(), v.minValue(12), v.maxValue(64)),
    backendUrl: v.string(),
    oauthClientId: v.optional(v.pipe(v.string(), v.minLength(1))),
    texts: v.optional(SettingsTextsSchema),
});
export type SettingsV2 = v.InferOutput<typeof SettingsSchema>;

export const MachineClientSchema = v.looseObject({
    id: v.pipe(v.string(), v.regex(/^[a-z0-9-]{3,40}$/)),
    name: v.string(),
    publicKeys: v.pipe(v.array(v.pipe(v.string(), v.check(decodesTo32Bytes, 'must decode to 32 bytes'))), v.minLength(1)),
    permissions: v.array(v.picklist(['entries:read'])),
    createdAt: v.string(),
});
export type MachineClient = v.InferOutput<typeof MachineClientSchema>;

const GroupRef = v.looseObject({ groupId: v.pipe(v.number(), v.integer(), v.minValue(1)), createdBySetup: v.boolean() });

export const AccessSchema = v.looseObject({
    schema: v.literal(SCHEMA_VERSION),
    revision: Revision,
    groups: v.looseObject({ users: GroupRef, admins: GroupRef, service: GroupRef }),
    machineClients: v.array(MachineClientSchema),
});
export type AccessV2 = v.InferOutput<typeof AccessSchema>;
