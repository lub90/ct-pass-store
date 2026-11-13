import { describe, expect, it } from 'vitest';
import { createFakeChurchTools, type FakeCtSeed } from '@/dev/fake-churchtools';
import { defineCtContract } from './contract-cases';
import { CtForbiddenError, CtHttpError, CtRateLimitedError, NotAuthenticatedError } from './errors';
import type { Permissions } from './types';

const all = (ids: number[]): Permissions => ({
    view: true,
    'view custom category': ids,
    'create custom category': false,
    'edit custom category': [],
    'delete custom category': [],
    'view custom data': ids,
    'create custom data': ids,
    'edit custom data': ids,
    'delete custom data': ids,
});

const seed = (over: Partial<FakeCtSeed> = {}): FakeCtSeed => ({
    moduleKey: 'ctpassstore',
    moduleId: 7,
    currentPersonId: 1,
    persons: [
        { id: 1, firstName: 'Anna', lastName: 'Admin' },
        { id: 2, firstName: 'Ben', lastName: 'Member' },
        { id: 3, firstName: 'Cora', lastName: 'Other' },
    ],
    groups: [
        { id: 10, name: 'Team', memberIds: [1, 2] },
        { id: 11, name: 'Others', memberIds: [3] },
    ],
    categories: [{ id: 5, name: 'Settings', shorty: 'settings' }],
    values: [],
    permissions: all([5]),
    ...over,
});

defineCtContract('in-memory fake', async () => ({
    ...createFakeChurchTools(seed()),
    knownPersonId: 1,
    knownGroupId: 10,
    foreignGroupId: 11,
    moduleKey: 'ctpassstore',
    anonymous: async () => createFakeChurchTools(seed({ currentPersonId: null })),
    limited: async () => createFakeChurchTools(seed({ permissions: all([]) })),
}));

describe('fake controls', () => {
    it('failNext fails exactly one call with the mapped error', async () => {
        const fake = createFakeChurchTools(seed());
        fake.failNext(403);
        await expect(fake.whoami()).rejects.toBeInstanceOf(CtForbiddenError);
        await expect(fake.whoami()).resolves.toMatchObject({ id: 1 });
        fake.failNext(401);
        await expect(fake.whoami()).rejects.toBeInstanceOf(NotAuthenticatedError);
        fake.failNext(429);
        const e = await fake.whoami().catch((x: unknown) => x);
        expect(e).toBeInstanceOf(CtRateLimitedError);
        expect((e as CtRateLimitedError).retryAfterMs).toBe(60_000);
        fake.failNext(500);
        await expect(fake.whoami()).rejects.toBeInstanceOf(CtHttpError);
    });

    it('"view group" opens a group and makes its members findable', async () => {
        const fake = createFakeChurchTools(seed());
        await expect(fake.groupMembers(11)).rejects.toBeInstanceOf(CtForbiddenError);
        await expect(fake.person(3)).rejects.toBeInstanceOf(CtHttpError);
        fake.setViewGroups([11]);
        expect((await fake.groupMembers(11)).map((m) => m.name)).toEqual(['Cora Other']);
        expect((await fake.person(3)).name).toBe('Cora Other');
    });

    it('setCurrentPerson and setGroups change what is readable', async () => {
        const fake = createFakeChurchTools(seed());
        fake.setCurrentPerson(3);
        await expect(fake.group(10)).rejects.toBeInstanceOf(CtForbiddenError);
        fake.setGroups([{ id: 10, name: 'Team', memberIds: [1, 2, 3] }]);
        expect((await fake.group(10)).memberCount).toBe(3);
    });

    it('a value needs the matching right per category', async () => {
        const fake = createFakeChurchTools(seed());
        fake.setPermissions({ ...all([5]), 'view custom data': [], 'create custom data': [] });
        await expect(fake.values(7, 5)).rejects.toBeInstanceOf(CtForbiddenError);
        await expect(fake.createValue(7, 5, '{}')).rejects.toBeInstanceOf(CtForbiddenError);
        expect((await fake.categories(7)).map((c) => c.shorty)).toEqual(['settings']);
    });
});
