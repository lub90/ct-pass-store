/**
 * The saving rules of every settings page (spec 4.4), without the page: a working copy of the stored value, Save and
 * Discard only after a change, „Gespeichert“, conflicts reported instead of overwriting (the store compares the
 * revision read here), and a question before leaving with unsaved changes (router and browser).
 *
 * The page decides when to `load()` (only once its own rights allow it), and what an `invalid` read may become
 * (`repair`): a page that can't rebuild the value without writing fields it doesn't own offers no repair.
 */
import { computed, onBeforeUnmount, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { CtForbiddenError, CtRateLimitedError, NotAuthenticatedError } from '../ct/errors';
import { CategoryMissingError, ConflictError, InvalidValueError, ValueTooLargeError } from '../model/errors';
import { retryMinutes } from '../backend/problems';
import { VALUE_LIMIT, type Read } from '../store/repository';
import type { ConfirmOptions, ConfirmResult } from '../ui/useConfirm';

export type InvalidRead<T> = Extract<Read<T>, { state: 'invalid' }>;

/**
 * - `idle`: nothing loaded (the page hasn't allowed it).
 * - `ready`: `value` holds the form; with `repairing`, it was rebuilt from an invalid stored value.
 * - `invalid`: the stored value is invalid and this page can't repair it.
 */
export type FormStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'newer' | 'invalid' | 'error';

export interface SettingsFormOptions<T> {
    /**
     * Turns a valid stored value into the unchanged state of the form (e.g. with an empty draft entry appended): what
     * counts as no change, and what Discard returns to. Gets a copy.
     */
    prepare?: (stored: T) => T;
    /** The value an explicit repair save of an `invalid` read starts from; `null`: not repairable here. */
    repair?: (read: InvalidRead<T>) => T | null;
    /**
     * Asked right before writing, with what would be written and the value as stored (`null` while repairing): `false`
     * writes nothing and keeps the change (e.g. a confirm dialog for a risky field).
     */
    beforeSave?: (next: T, previous: T | null) => Promise<boolean>;
    /** After a successful save (e.g. the app reloads its settings). */
    onSaved?: () => void | Promise<void>;
    /** Asks before leaving with unsaved changes (`useConfirm`). */
    confirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
    /** The texts of that question. */
    leaveQuestion: () => ConfirmOptions;
}

export interface SettingsForm<T> {
    status: Ref<FormStatus>;
    /** The working copy; edit its fields directly. `null` unless `ready`. */
    value: Ref<T | null>;
    /** What the read left out or found invalid (plain text). */
    issues: Ref<string[]>;
    /** The value was rebuilt from an invalid stored one: saving replaces it (with the stored revision). */
    repairing: Ref<boolean>;
    dirty: ComputedRef<boolean>;
    saving: Ref<boolean>;
    /** Set by a successful save; „Gespeichert“ shows while nothing changed since. */
    savedAt: Ref<number | null>;
    /** The last read, when it was `invalid` (whether or not this page repairs it). */
    invalidRead: Ref<InvalidRead<T> | null>;
    /** The last save failed (not a conflict). */
    error: Ref<unknown>;
    /** The load failed. */
    loadError: Ref<unknown>;
    /** The stored value changed since it was read: nothing was written. */
    conflict: Ref<boolean>;
    load(): Promise<void>;
    /** Saves the working copy if it changed; never twice at once. */
    save(): Promise<void>;
    discard(): void;
}

/** JSON with sorted keys, so the same value compares equal whatever order its fields were set in. */
export function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) =>
        typeof v === 'object' && v !== null && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
            : v,
    );
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function useSettingsForm<T extends { revision: number }>(
    load: () => Promise<Read<T>>,
    save: (value: T, revision: number) => Promise<void>,
    options: SettingsFormOptions<T>,
): SettingsForm<T> {
    const status = ref<FormStatus>('idle');
    const value = ref(null) as Ref<T | null>;
    const issues = ref<string[]>([]);
    const repairing = ref(false);
    const saving = ref(false);
    const savedAt = ref<number | null>(null);
    const error = shallowRef<unknown>(null);
    const loadError = shallowRef<unknown>(null);
    const conflict = ref(false);
    const invalidRead = shallowRef<InvalidRead<T> | null>(null);
    /** The stored value as read (canonical JSON); `null` while repairing (then every state is a change). */
    let baseline: string | null = null;
    let revision = 0;
    let run = 0;
    /** `beforeSave` is waiting for its answer. */
    let asking = false;

    const dirty = computed(() => value.value !== null && (repairing.value || canonical(value.value) !== baseline));

    async function reload(): Promise<void> {
        const mine = ++run;
        status.value = 'loading';
        value.value = null;
        error.value = null;
        loadError.value = null;
        conflict.value = false;
        savedAt.value = null;
        let read: Read<T>;
        try {
            read = await load();
        } catch (e) {
            if (mine !== run) return;
            loadError.value = e;
            status.value = 'error';
            return;
        }
        if (mine !== run) return;
        issues.value = read.state === 'ok' || read.state === 'invalid' ? (read.issues ?? []) : [];
        invalidRead.value = read.state === 'invalid' ? read : null;
        repairing.value = false;
        if (read.state === 'ok') {
            const shown = options.prepare ? options.prepare(copy(read.value)) : read.value;
            baseline = canonical(shown);
            revision = read.value.revision;
            value.value = copy(shown);
            status.value = 'ready';
        } else if (read.state === 'invalid') {
            const base = read.revision === undefined ? null : (options.repair?.(read) ?? null);
            if (base === null || read.revision === undefined) {
                status.value = 'invalid';
                return;
            }
            baseline = null;
            revision = read.revision;
            repairing.value = true;
            value.value = base;
            status.value = 'ready';
        } else {
            status.value = read.state;
        }
    }

    async function doSave(): Promise<void> {
        const current = value.value;
        if (current === null || saving.value || asking || !dirty.value) return;
        // What is asked about is what gets written, even if the form changes while the question is open.
        const sent = copy(current);
        if (options.beforeSave) {
            const loaded = run;
            asking = true;
            let go: boolean;
            try {
                go = await options.beforeSave(copy(sent), baseline === null ? null : (JSON.parse(baseline) as T));
            } finally {
                asking = false;
            }
            // A reload meanwhile replaced what was asked about (and the revision the save would compare).
            if (!go || loaded !== run) return;
        }
        saving.value = true;
        error.value = null;
        conflict.value = false;
        try {
            await save(sent, revision);
        } catch (e) {
            if (e instanceof ConflictError) conflict.value = true;
            else error.value = e;
            return;
        } finally {
            saving.value = false;
        }
        // The store wrote exactly this, one revision up; what the read had dropped is gone now.
        revision += 1;
        baseline = canonical({ ...sent, revision });
        value.value = { ...value.value!, revision };
        repairing.value = false;
        invalidRead.value = null;
        issues.value = [];
        savedAt.value = Date.now();
        await options.onSaved?.();
    }

    function discard(): void {
        if (repairing.value || baseline === null) {
            void reload();
            return;
        }
        value.value = JSON.parse(baseline) as T;
        error.value = null;
        conflict.value = false;
    }

    const askBeforeLeaving = async (): Promise<boolean> => {
        if (!dirty.value) return true;
        const answer = await options.confirm(options.leaveQuestion());
        return answer.confirmed;
    };
    onBeforeRouteLeave(askBeforeLeaving);
    // Same page, other params (e.g. another machine client): the page is mounted afresh, so this is a leave too.
    onBeforeRouteUpdate(askBeforeLeaving);

    const onUnload = (event: BeforeUnloadEvent | Event): void => {
        if (!dirty.value) return;
        event.preventDefault();
        // Older browsers need a return value to ask.
        (event as BeforeUnloadEvent).returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    onBeforeUnmount(() => window.removeEventListener('beforeunload', onUnload));

    return { status, value, issues, repairing, dirty, saving, savedAt, error, loadError, conflict, invalidRead, load: reload, save: doSave, discard };
}

/** The text (i18n key and params) for a failed load or save of `settings` (or `category`). */
export function settingsErrorText(error: unknown, category: 'settings' | 'access' = 'settings'): { key: string; params: Record<string, string | number> } {
    if (error instanceof CtForbiddenError) return { key: 'settings.missingRight', params: { right: error.missing ?? 'edit custom data', category } };
    if (error instanceof CtRateLimitedError) return { key: 'state.ctRateLimited', params: { n: retryMinutes(error.retryAfterMs / 1000) } };
    if (error instanceof NotAuthenticatedError) return { key: 'manage.ctLoggedOut', params: {} };
    if (error instanceof ValueTooLargeError) return { key: 'settings.tooLarge', params: { size: error.size, limit: VALUE_LIMIT } };
    // `access`: also a new client that collides with a stored entry the backend can't use (the store refuses it).
    if (error instanceof InvalidValueError) return { key: category === 'access' ? 'access.notSaved' : 'settings.notSaved', params: {} };
    if (error instanceof CategoryMissingError) return { key: 'settings.categoryMissing', params: { category } };
    return { key: 'state.ctUnavailable', params: {} };
}
