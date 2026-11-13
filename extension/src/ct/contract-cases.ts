import { describe, expect, it } from 'vitest';
import type { CtApi } from './api';
import { CtForbiddenError, NotAuthenticatedError } from './errors';

/**
 * What a contract run needs. `anonymous` and `limited` are optional because not every subject can offer them
 * (the real test instance needs a second session); the cases that need them are skipped without them.
 */
export type CtContractSubject = CtApi & {
    /** A person the current session may read, and who is a member of `knownGroupId`. */
    knownPersonId: number;
    /** A group the current person is a member of. */
    knownGroupId: number;
    /** A group the current person is not a member of and has no "view group" right on. */
    foreignGroupId: number;
    moduleKey: string;
    /** An API without a login. */
    anonymous?: () => Promise<CtApi>;
    /** An API of a person without any rights on the module's categories. */
    limited?: () => Promise<CtApi>;
};

/** The cases are written once and run against the fake now and against the real test instance later. */
export function defineCtContract(name: string, make: () => Promise<CtContractSubject>): void {
    describe(`ChurchTools contract: ${name}`, () => {
        it('whoami answers the current person', async () => {
            const s = await make();
            const me = await s.whoami();
            expect(me.id).toBeGreaterThan(0);
            expect(typeof me.firstName).toBe('string');
        });

        it('whoami without a login throws NotAuthenticatedError (id -1 or 0)', async (ctx) => {
            const s = await make();
            if (!s.anonymous) return ctx.skip();
            const anonymous = await s.anonymous();
            await expect(anonymous.whoami()).rejects.toBeInstanceOf(NotAuthenticatedError);
        });

        it('globalPermissions has the documented shape', async () => {
            const s = await make();
            const p = await s.globalPermissions();
            expect(typeof p.view).toBe('boolean');
            expect(Array.isArray(p['view custom category'])).toBe(true);
            expect(Array.isArray(p['edit custom data'])).toBe(true);
        });

        it('an unknown module key gives null, a known one an id', async () => {
            const s = await make();
            expect(await s.moduleId('no-such-module-key')).toBeNull();
            expect(typeof (await s.moduleId(s.moduleKey))).toBe('number');
        });

        it('categories without "view custom category" are absent', async (ctx) => {
            const s = await make();
            if (!s.limited) return ctx.skip();
            const moduleId = await s.moduleId(s.moduleKey);
            expect(moduleId).not.toBeNull();
            const limited = await s.limited();
            const visible = await limited.categories(moduleId as number).catch((e: unknown) => {
                if (e instanceof CtForbiddenError) return [];
                throw e;
            });
            expect(visible).toEqual([]);
        });

        it('a value survives a create, read, update, delete round trip', async () => {
            const s = await make();
            const moduleId = (await s.moduleId(s.moduleKey)) as number;
            const category = (await s.categories(moduleId))[0];
            expect(category).toBeDefined();
            const categoryId = category!.id;
            expect(typeof category!.name).toBe('string');
            expect(typeof category!.shorty).toBe('string');

            const created = await s.createValue(moduleId, categoryId, '{"probe":1}');
            try {
                expect(created.dataCategoryId).toBe(categoryId);
                expect((await s.values(moduleId, categoryId)).find((v) => v.id === created.id)?.value).toBe('{"probe":1}');
                const updated = await s.updateValue(moduleId, categoryId, created.id, '{"probe":2}');
                expect(updated.value).toBe('{"probe":2}');
                expect((await s.values(moduleId, categoryId)).find((v) => v.id === created.id)?.value).toBe('{"probe":2}');
            } finally {
                await s.deleteValue(moduleId, categoryId, created.id);
            }
            expect((await s.values(moduleId, categoryId)).some((v) => v.id === created.id)).toBe(false);
        });

        it('a group the person is a member of is readable', async () => {
            const s = await make();
            const group = await s.group(s.knownGroupId);
            expect(group.id).toBe(s.knownGroupId);
            expect(group.name.length).toBeGreaterThan(0);
            expect(group.memberCount).toBeGreaterThanOrEqual(1);
            const members = await s.groupMembers(s.knownGroupId);
            expect(members.some((m) => m.id === s.knownPersonId)).toBe(true);
            expect(members.every((m) => m.name.length > 0)).toBe(true);
            // Only active, non-archived members are listed (a `waiting` member or an archived person is not), and
            // the count is that list's length, never an `information` key of the group.
            expect(group.memberCount).toBe(members.length);
        });

        it('another group gives CtForbiddenError', async () => {
            const s = await make();
            await expect(s.group(s.foreignGroupId)).rejects.toBeInstanceOf(CtForbiddenError);
            await expect(s.groupMembers(s.foreignGroupId)).rejects.toBeInstanceOf(CtForbiddenError);
        });

        it('person answers id and name', async () => {
            const s = await make();
            const person = await s.person(s.knownPersonId);
            expect(person.id).toBe(s.knownPersonId);
            expect(person.name.length).toBeGreaterThan(0);
        });
    });
}
