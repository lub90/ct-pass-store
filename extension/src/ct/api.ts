import type { ChurchToolsClient } from '@churchtools/churchtools-client';
import { EXTENSION_KEY } from '@/config';
import type { PersonOption } from '@/ui';
import { createClient, retryAfterMs } from './client';
import { CtForbiddenError, CtHttpError, CtInvalidIdError, CtRateLimitedError, NotAuthenticatedError } from './errors';
import type { CtCategory, CtGroup, CtValue, CtWhoAmI, Permissions } from './types';

/**
 * Everything the app asks of ChurchTools. Only this module (with `store/` and `backend/`) talks to the network.
 * The measured quirks are documented on the members below; details in specs/ct-extension-info.md.
 */
export interface CtApi {
    /**
     * The current person. QUIRK: with nobody logged in, ChurchTools answers `200` with `id` -1 (or 0), not `401`;
     * both become `NotAuthenticatedError`.
     */
    whoami(): Promise<CtWhoAmI>;
    /**
     * The person's rights on this extension's module. Don't read them from the page's embedded settings (pruned,
     * differently encoded). Missing rights are normalised to `false` / `[]`. May be cached by ChurchTools briefly.
     */
    globalPermissions(): Promise<Permissions>;
    /**
     * The module ID for an extension key, or `null`. QUIRK: for an unknown key (or a module the person can't see)
     * ChurchTools answers `400 validation.integer`, not `404`, because it tries to read the key as a numeric ID.
     */
    moduleId(key: string): Promise<number | null>;
    /**
     * The categories the person may see. QUIRK: a category is listed only with `view custom category`; its values
     * additionally need `view custom data`. Without the right it is absent, not an error.
     */
    categories(moduleId: number): Promise<CtCategory[]>;
    /** All values of a category. Needs `view custom data` on it (`403` otherwise, `missing` names the right). */
    values(moduleId: number, categoryId: number): Promise<CtValue[]>;
    /** `value` is a JSON string of at most 10,000 characters. Needs `create custom data`. */
    createValue(moduleId: number, categoryId: number, value: string): Promise<CtValue>;
    /** Needs `edit custom data`. There is no version or ETag: concurrent writers overwrite each other silently. */
    updateValue(moduleId: number, categoryId: number, valueId: number, value: string): Promise<CtValue>;
    /** Needs `delete custom data`. */
    deleteValue(moduleId: number, categoryId: number, valueId: number): Promise<void>;
    /**
     * Members of a group, with names. QUIRK: readable for a group the person is a member of, or with the
     * `churchgroup` right "view group" on it; any other group answers `403 Forbidden to see group`.
     */
    groupMembers(groupId: number): Promise<PersonOption[]>;
    /** Same visibility rule as `groupMembers`: `CtForbiddenError` for a group the person may not see. */
    group(groupId: number): Promise<CtGroup>;
    /**
     * One person. Only persons the caller may see are readable (members of readable groups, via "view group", or
     * everyone with `view alldata`).
     */
    person(id: number): Promise<PersonOption>;
}

interface HttpErrorLike {
    response?: { status?: number; headers?: unknown; data?: { message?: unknown } };
}

/** Maps an axios error to the layer's errors; anything else (network error, our own errors) passes unchanged. */
export function mapCtError(error: unknown, missing?: string): unknown {
    const response = (error as HttpErrorLike | null)?.response;
    const status = response?.status;
    if (typeof status !== 'number') return error;
    const message = typeof response?.data?.message === 'string' ? response.data.message : undefined;
    if (status === 401) return new NotAuthenticatedError(message);
    if (status === 403) return new CtForbiddenError(message, missing);
    if (status === 429) return new CtRateLimitedError(retryAfterMs(response ?? {}));
    return new CtHttpError(status, message);
}

async function guarded<T>(call: () => Promise<T>, missing?: string): Promise<T> {
    try {
        return await call();
    } catch (error) {
        throw mapCtError(error, missing);
    }
}

type Json = Record<string, unknown>;
/** Every ID that ends up in a request path goes through this first: a positive safe integer, or no request. */
function assertId(n: unknown): asserts n is number {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new CtInvalidIdError(n);
}
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const fullName = (first: unknown, last: unknown): string => `${text(first)} ${text(last)}`.trim();

/** The real implementation. `client` and `moduleKey` are parameters for tests; the app uses the defaults. */
export function createCtApi(client: ChurchToolsClient = createClient(), moduleKey: string = EXTENSION_KEY): CtApi {
    const categoryPath = (moduleId: number) => `/custommodules/${moduleId}/customdatacategories`;
    const valuesPath = (moduleId: number, categoryId: number) => `${categoryPath(moduleId)}/${categoryId}/customdatavalues`;

    /**
     * Only members with `groupMemberStatus === 'active'` (ChurchTools also has `waiting`, `requested`, `to_delete`)
     * who aren't archived. Paged: the default limit is 10, so all pages are read.
     */
    async function activeMembers(groupId: number): Promise<PersonOption[]> {
        assertId(groupId);
        const members = await guarded(() => client.getAllPages<Json>(`/groups/${groupId}/members`), 'view group');
        const result = new Map<number, PersonOption>();
        for (const m of members) {
            const person = (m.person ?? {}) as Json;
            const attrs = (person.domainAttributes ?? {}) as Json;
            if (m.groupMemberStatus !== 'active' || attrs.isArchived === true) continue;
            // `personId` is a number here; `domainIdentifier` is a string (as in persons/{id}/groups).
            const id = Number(m.personId ?? person.domainIdentifier);
            if (!Number.isSafeInteger(id) || id <= 0 || result.has(id)) continue;
            const name = text(person.title) || fullName(attrs.firstName, attrs.lastName);
            if (name) result.set(id, { id, name });
        }
        return [...result.values()];
    }

    return {
        async whoami() {
            const me = await guarded(() => client.get<Json>('/whoami'));
            // Fail closed: anything but a positive integer (-1, 0, missing, a string) counts as not logged in.
            const id = me.id;
            if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new NotAuthenticatedError();
            return { id, firstName: text(me.firstName), lastName: text(me.lastName) };
        },

        async globalPermissions() {
            const all = await guarded(() => client.get<unknown>('/permissions/global'));
            const entry = all && typeof all === 'object' ? (all as Record<string, unknown>)[moduleKey] : undefined;
            const own: Record<string, unknown> = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
            // Only real positive integers count as category IDs; anything else grants nothing.
            const ids = (key: string): number[] => {
                const list = own[key];
                return Array.isArray(list) ? list.filter((x): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0) : [];
            };
            return {
                view: own.view === true,
                'create custom category': own['create custom category'] === true,
                'view custom category': ids('view custom category'),
                'edit custom category': ids('edit custom category'),
                'delete custom category': ids('delete custom category'),
                'view custom data': ids('view custom data'),
                'create custom data': ids('create custom data'),
                'edit custom data': ids('edit custom data'),
                'delete custom data': ids('delete custom data'),
            };
        },

        async moduleId(key) {
            try {
                const module = await client.get<Json>(`/custommodules/${encodeURIComponent(key)}`);
                return typeof module.id === 'number' ? module.id : null;
            } catch (error) {
                if ((error as HttpErrorLike | null)?.response?.status === 400) return null;
                throw mapCtError(error);
            }
        },

        async categories(moduleId) {
            assertId(moduleId);
            const list = await guarded(() => client.get<Json[]>(categoryPath(moduleId)));
            return list.map((c) => ({ id: Number(c.id), name: text(c.name), shorty: text(c.shorty) }));
        },

        async values(moduleId, categoryId) {
            assertId(moduleId);
            assertId(categoryId);
            const list = await guarded(() => client.get<Json[]>(valuesPath(moduleId, categoryId)), 'view custom data');
            return list.map((v) => toValue(v, categoryId));
        },

        async createValue(moduleId, categoryId, value) {
            assertId(moduleId);
            assertId(categoryId);
            const created = await guarded(
                () => client.post<Json>(valuesPath(moduleId, categoryId), { dataCategoryId: categoryId, value }),
                'create custom data',
            );
            return toValue(created, categoryId);
        },

        async updateValue(moduleId, categoryId, valueId, value) {
            assertId(moduleId);
            assertId(categoryId);
            assertId(valueId);
            const updated = await guarded(
                () => client.put<Json>(`${valuesPath(moduleId, categoryId)}/${valueId}`, { dataCategoryId: categoryId, value }),
                'edit custom data',
            );
            return toValue(updated, categoryId);
        },

        async deleteValue(moduleId, categoryId, valueId) {
            assertId(moduleId);
            assertId(categoryId);
            assertId(valueId);
            await guarded(() => client.deleteApi<unknown>(`${valuesPath(moduleId, categoryId)}/${valueId}`), 'delete custom data');
        },

        async groupMembers(groupId) {
            return activeMembers(groupId);
        },

        async group(groupId) {
            assertId(groupId);
            // `GET /groups/{id}` has no member count (`information.memberCount` doesn't exist, `memberStatistics` is
            // null), so it is the length of the filtered member list. That list needs the same right as the group.
            const g = await guarded(() => client.get<Json>(`/groups/${groupId}`), 'view group');
            return { id: Number(g.id), name: text(g.name), memberCount: (await activeMembers(groupId)).length };
        },

        async person(id) {
            assertId(id);
            const p = await guarded(() => client.get<Json>(`/persons/${id}`));
            return { id: Number(p.id), name: fullName(p.firstName, p.lastName) };
        },
    };
}

function toValue(v: Json, fallbackCategoryId: number): CtValue {
    return { id: Number(v.id), dataCategoryId: Number(v.dataCategoryId ?? fallbackCategoryId), value: text(v.value) };
}
