import type { CtApi } from '@/ct/api';
import { CtForbiddenError, CtHttpError, CtRateLimitedError, NotAuthenticatedError } from '@/ct/errors';
import type { CtCategory, CtValue, Permissions } from '@/ct/types';
import type { PersonOption } from '@/ui';

/**
 * In-memory ChurchTools for tests and the demo. Behaves like the measured instance (specs/ct-extension-info.md):
 * anonymous `whoami`, unknown module → `null`, categories listed only with `view custom category`, values need
 * `view custom data`, groups readable for members or with "view group". Never imported by production modules.
 */
export interface FakeCtSeed {
    moduleKey: string;
    moduleId: number;
    /** `null` = nobody logged in. */
    currentPersonId: number | null;
    persons: { id: number; firstName: string; lastName: string }[];
    groups: FakeGroup[];
    categories: CtCategory[];
    values: CtValue[];
    permissions: Permissions;
    /** Groups the current person has the "view group" right on. */
    viewGroupIds?: number[];
}

export interface FakeGroup {
    id: number;
    name: string;
    memberIds: number[];
}

export interface FakeControls {
    setCurrentPerson(id: number | null): void;
    setPermissions(permissions: Permissions): void;
    setGroups(groups: FakeGroup[]): void;
    setViewGroups(ids: number[]): void;
    /** The next call (of any method) fails with the error ChurchTools' status maps to. */
    failNext(status: number): void;
}

export function createFakeChurchTools(seed: FakeCtSeed): CtApi & FakeControls {
    let current = seed.currentPersonId;
    let permissions = seed.permissions;
    let groups = seed.groups.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
    let viewGroups = [...(seed.viewGroupIds ?? [])];
    const values = seed.values.map((v) => ({ ...v }));
    let nextValueId = Math.max(0, ...values.map((v) => v.id)) + 1;
    let failure: number | null = null;

    const nameOf = (id: number): string => {
        const p = seed.persons.find((x) => x.id === id);
        return p ? `${p.firstName} ${p.lastName}`.trim() : '';
    };
    const canSeeGroup = (g: FakeGroup) => viewGroups.includes(g.id) || (current !== null && g.memberIds.includes(current));
    const readableGroup = (id: number): FakeGroup => {
        const g = groups.find((x) => x.id === id);
        if (!g) throw new CtHttpError(404, 'Group not found');
        if (!canSeeGroup(g)) throw new CtForbiddenError('Forbidden to see group', 'view group');
        return g;
    };
    const step = () => {
        if (failure === null) return;
        const status = failure;
        failure = null;
        if (status === 401) throw new NotAuthenticatedError();
        if (status === 403) throw new CtForbiddenError();
        if (status === 429) throw new CtRateLimitedError(60_000);
        throw new CtHttpError(status);
    };
    const requireModule = (moduleId: number) => {
        if (moduleId !== seed.moduleId) throw new CtHttpError(400, 'validation.integer');
    };
    const requireRight = (right: keyof Permissions & `${string} custom data`, categoryId: number) => {
        if (!permissions[right].includes(categoryId)) throw new CtForbiddenError(`Missing right: ${right}`, right);
    };
    const requireCategory = (moduleId: number, categoryId: number) => {
        requireModule(moduleId);
        if (!seed.categories.some((c) => c.id === categoryId)) throw new CtHttpError(404, 'Category not found');
    };

    return {
        setCurrentPerson: (id) => void (current = id),
        setPermissions: (p) => void (permissions = p),
        setGroups: (g) => void (groups = g.map((x) => ({ ...x, memberIds: [...x.memberIds] }))),
        setViewGroups: (ids) => void (viewGroups = [...ids]),
        failNext: (status) => void (failure = status),

        async whoami() {
            step();
            // Real ChurchTools answers 200 with id -1 for an anonymous caller.
            const id = current ?? -1;
            if (id <= 0) throw new NotAuthenticatedError();
            const p = seed.persons.find((x) => x.id === id);
            return { id, firstName: p?.firstName ?? '', lastName: p?.lastName ?? '' };
        },
        async globalPermissions() {
            step();
            return structuredClone(permissions);
        },
        async moduleId(key) {
            step();
            return key === seed.moduleKey ? seed.moduleId : null;
        },
        async categories(moduleId) {
            step();
            requireModule(moduleId);
            return seed.categories.filter((c) => permissions['view custom category'].includes(c.id)).map((c) => ({ ...c }));
        },
        async values(moduleId, categoryId) {
            step();
            requireCategory(moduleId, categoryId);
            requireRight('view custom data', categoryId);
            return values.filter((v) => v.dataCategoryId === categoryId).map((v) => ({ ...v }));
        },
        async createValue(moduleId, categoryId, value) {
            step();
            requireCategory(moduleId, categoryId);
            requireRight('create custom data', categoryId);
            const created = { id: nextValueId++, dataCategoryId: categoryId, value };
            values.push(created);
            return { ...created };
        },
        async updateValue(moduleId, categoryId, valueId, value) {
            step();
            requireCategory(moduleId, categoryId);
            requireRight('edit custom data', categoryId);
            const existing = values.find((v) => v.id === valueId && v.dataCategoryId === categoryId);
            if (!existing) throw new CtHttpError(404, 'Value not found');
            existing.value = value;
            return { ...existing };
        },
        async deleteValue(moduleId, categoryId, valueId) {
            step();
            requireCategory(moduleId, categoryId);
            requireRight('delete custom data', categoryId);
            const index = values.findIndex((v) => v.id === valueId && v.dataCategoryId === categoryId);
            if (index < 0) throw new CtHttpError(404, 'Value not found');
            values.splice(index, 1);
        },
        async groupMembers(groupId): Promise<PersonOption[]> {
            step();
            return readableGroup(groupId).memberIds.map((id) => ({ id, name: nameOf(id) }));
        },
        async group(groupId) {
            step();
            const g = readableGroup(groupId);
            return { id: g.id, name: g.name, memberCount: g.memberIds.length };
        },
        async person(id): Promise<PersonOption> {
            step();
            // Persons are visible through readable groups (member or "view group"), and the caller sees themselves.
            const visible = id === current || groups.some((g) => canSeeGroup(g) && g.memberIds.includes(id));
            if (!visible || !seed.persons.some((p) => p.id === id)) throw new CtHttpError(404, 'Person not found');
            return { id, name: nameOf(id) };
        },
    };
}
