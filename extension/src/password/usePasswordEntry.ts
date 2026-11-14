/**
 * The backend entry of one person (spec 4.2, 4.3): its status and the three changes. Every request goes through
 * `session.call()` (renewal on `token-expired`). Nothing here keeps a password: `generate()` hands the new one to the
 * caller, which shows it once and drops it.
 */
import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { useServices } from '../app/services';
import { useAppState } from '../app/useAppState';
import { useSession } from '../app/useSession';
import type { BackendApi } from '../backend/api';
import { UnexpectedResponse } from '../backend/problems';

export type EntryStatus = 'loading' | 'set' | 'none' | 'error';

export interface PasswordEntry {
    status: Ref<EntryStatus>;
    /** Why the status is `error`. */
    error: Ref<unknown>;
    reload(): Promise<void>;
    /** Stores a generated password and resolves with its plaintext. */
    generate(primaryPwd?: string): Promise<string>;
    setCustom(password: string, primaryPwd?: string): Promise<void>;
    remove(primaryPwd?: string): Promise<void>;
}

/**
 * `personId` `null` means: not allowed or not known yet; nothing is requested then. `load: false` gives only the
 * changes, without reading the status (a form inside a page that reads it already).
 */
export function usePasswordEntry(personId: MaybeRefOrGetter<number | null>, options: { load?: boolean } = {}): PasswordEntry {
    const services = useServices();
    const session = useSession();
    const app = useAppState();

    const status = ref<EntryStatus>('loading');
    const error = ref<unknown>(null);
    /** Only the newest read may set the status (the person can change while one is pending). */
    let latest = 0;

    function api(): BackendApi {
        const url = app.settings.value?.backendUrl;
        if (!url) throw new Error('No backend configured');
        return services.backend(url);
    }

    function person(): number {
        const id = toValue(personId);
        if (id === null) throw new Error('No person');
        return id;
    }

    async function reload(): Promise<void> {
        const id = toValue(personId);
        const mine = ++latest;
        status.value = 'loading';
        error.value = null;
        if (id === null) return;
        try {
            const found = await session.call(() => api().getEntry(id));
            if (mine === latest) status.value = found;
        } catch (e) {
            if (mine !== latest) return;
            status.value = 'error';
            error.value = e;
        }
    }

    async function generate(primaryPwd?: string): Promise<string> {
        const id = person();
        const body = primaryPwd === undefined ? {} : { primaryPwd };
        const { generated } = await session.call(() => api().putEntry(id, body));
        if (generated === undefined) throw new UnexpectedResponse(200);
        status.value = 'set';
        return generated;
    }

    async function setCustom(password: string, primaryPwd?: string): Promise<void> {
        const id = person();
        const body = primaryPwd === undefined ? { secondaryPwd: password } : { secondaryPwd: password, primaryPwd };
        await session.call(() => api().putEntry(id, body));
        status.value = 'set';
    }

    async function remove(primaryPwd?: string): Promise<void> {
        const id = person();
        await session.call(() => api().deleteEntry(id, primaryPwd));
        status.value = 'none';
    }

    if (options.load !== false) watch(() => toValue(personId), () => void reload(), { immediate: true });

    return { status, error, reload, generate, setCustom, remove };
}
