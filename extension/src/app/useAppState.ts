/**
 * Startup (spec 3.2, 7.1): reads ChurchTools and the settings, binds the login to them and computes the app state.
 *
 * Order, each step only after the previous one allows it:
 * 1. On `/auth/callback`: keep the query in memory and replace the address with the bare callback path, so code and
 *    state are neither in the address bar, the history nor a `Referer` while ChurchTools is read. In a login popup:
 *    hand the code to the opener and stop (nothing else is read).
 * 2. `whoami` and the extension's rights (row 2), the layout and the settings (rows 3 to 5).
 * 3. `auth.configure()` with the settings and `auth.bindPerson()` with whoami's id, before any login decision.
 * 4. On `/auth/callback` as a page: complete the login (a token of another person is refused); `oauth-code-invalid`
 *    retries the login once (spec 8.2). Otherwise without a usable token: a page login, unless one just completed
 *    (`recentPageLogin`, loop guard) — then `backend-error` without a redirect.
 * 5. Rows 6 to 10 from the login result and the session (role and version follow the token, display only).
 */
import { computed, inject, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { Router } from 'vue-router';
import { forwardPopupCallback, LoginStateError, type CallbackWindow } from '../backend/auth';
import { BackendProblem } from '../backend/problems';
import { CALLBACK_PATH, EXTENSION_KEY } from '../config';
import { NotAuthenticatedError } from '../ct/errors';
import type { SettingsV2 } from '../model/schemas';
import type { Read } from '../store/repository';
import {
    computeAppState,
    loginOutcome,
    settingsEditorFrom,
    settingsReady,
    setupCapableFrom,
    type AppState,
    type Failure,
    type SettingsEditor,
} from './app-state';
import type { Services } from './services';
import { LoginLoop, type Session } from './useSession';

export interface AppStateHandle {
    state: ComputedRef<AppState>;
    /** Why the state is `backend-error`, if it is. */
    failure: ComputedRef<Failure | null>;
    settingsEditor: Ref<SettingsEditor>;
    setupCapable: Ref<boolean>;
    /** The settings read at startup (`ok` only), for the pages; `reloadSettings()` refreshes them. */
    settings: Ref<SettingsV2 | null>;
    /** The ChurchTools person logged in (whoami), once known. „Mein Passwort“ acts for this person only. */
    personId: Ref<number | null>;
    /**
     * Reads `settings` again (e.g. after `custom-password-not-allowed`); keeps the old ones if the read fails.
     * `backendUrl` and `oauthClientId` stay as at startup: the login is configured with them, and a new address takes
     * effect only with the next page load.
     */
    reloadSettings(): Promise<void>;
    /** `update-needed`: the stored `schema`. */
    storedSchema: Ref<number | null>;
    appVersion: string;
    /** Display only (from the token), like `session.admin`. */
    backendVersion: Ref<string | null>;
    admin: Ref<boolean>;
    /** True on `/auth/callback` until the login there is done. */
    onCallback: Ref<boolean>;
    start(): Promise<void>;
    /** „Erneut anmelden“: a page login on the person's request, past the loop guard. */
    loginAgain(): void;
}

export interface AppStateDeps {
    services: Services;
    router: Router;
    session: Session;
    callbackWindow: CallbackWindow;
    appVersion: string;
}

const isCallbackPath = (path: string): boolean => path.toLowerCase().replace(/\/+$/, '') === `/${CALLBACK_PATH}`;

export function createAppState(deps: AppStateDeps): AppStateHandle {
    const { services, router, session } = deps;
    const { ct, store, auth } = services;

    const loading = ref(true);
    const anonymous = ref(false);
    const view = ref<boolean | null>(null);
    const ctError = ref<{ error: unknown } | null>(null);
    const oldLayout = ref(false);
    const storedSchema = ref<number | null>(null);
    const ready = ref(false);
    const loginError = ref<{ error: unknown } | null>(null);
    const settingsEditor = ref<SettingsEditor>({ settings: false, access: false });
    const setupCapable = ref(false);
    const settings = ref<SettingsV2 | null>(null);
    const personId = ref<number | null>(null);
    const onCallback = ref(false);

    /** The session reports a login loop later on (a token problem right after a page login). */
    const effectiveLoginError = computed(() => loginError.value ?? (session.loginLoop.value ? { error: new LoginLoop() } : null));

    const state = computed(() =>
        computeAppState({
            loading: loading.value,
            anonymous: anonymous.value,
            view: view.value,
            ctFailed: ctError.value !== null,
            oldLayout: oldLayout.value,
            newerSchema: storedSchema.value !== null,
            settingsReady: ready.value,
            login: loginOutcome(effectiveLoginError.value?.error ?? null),
            backendVersion: session.backendVersion.value,
            appVersion: deps.appVersion,
            admin: session.admin.value,
        }),
    );

    const failure = computed<Failure | null>(() => {
        if (state.value !== 'backend-error') return null;
        if (ctError.value) return { kind: 'churchtools', error: ctError.value.error };
        return { kind: 'login', error: effectiveLoginError.value?.error ?? null };
    });

    /** Leaves the callback URL (the code must not stay in the address bar or the history). */
    async function leaveCallback(path = '/'): Promise<void> {
        if (!onCallback.value) return;
        await router.replace(path);
        onCallback.value = false;
    }

    /** ChurchTools failed: `NotAuthenticatedError` is row 2, everything else an outage. */
    function ctFailed(error: unknown): void {
        if (error instanceof NotAuthenticatedError) anonymous.value = true;
        else ctError.value = { error };
    }

    async function readEditor(permissions: Awaited<ReturnType<typeof ct.globalPermissions>>): Promise<SettingsEditor> {
        try {
            const moduleId = await ct.moduleId(EXTENSION_KEY);
            if (moduleId === null) return { settings: false, access: false };
            return settingsEditorFrom(permissions, await ct.categories(moduleId));
        } catch {
            // Display only: without the categories nobody is shown the settings pages; ChurchTools checks writes anyway.
            return { settings: false, access: false };
        }
    }

    /** Rows 2 to 5. Returns what the login needs when it may follow. */
    async function readChurchTools(): Promise<{ personId: number; backendUrl: string; clientId: string } | null> {
        let person: number;
        try {
            person = (await ct.whoami()).id;
            const permissions = await ct.globalPermissions();
            view.value = permissions.view;
            if (!permissions.view) return null;
            setupCapable.value = setupCapableFrom(permissions);
            const [{ oldLayout: old, settings: read }, access, editor] = await Promise.all([
                store.readStartup(),
                // `access` matters here only for a newer schema; people who can't read it are not affected by it.
                store.readAccess().catch(() => null),
                readEditor(permissions),
            ]);
            settingsEditor.value = editor;
            oldLayout.value = old;
            const newer = [read, access].find((r): r is Extract<Read<unknown>, { state: 'newer' }> => r?.state === 'newer');
            if (newer) storedSchema.value = newer.schema;
            ready.value = settingsReady(read);
            if (read.state === 'ok') settings.value = read.value;
            personId.value = person;
        } catch (error) {
            ctFailed(error);
            return null;
        }
        if (oldLayout.value || storedSchema.value !== null || !ready.value) return null;
        const { backendUrl, oauthClientId } = settings.value ?? {};
        if (!backendUrl || !oauthClientId) return null;
        return { personId: person, backendUrl, clientId: oauthClientId };
    }

    /** Step 4. Resolves when the login is decided; stays pending while the page leaves for a page login. */
    async function login(callbackQuery: Record<string, unknown> | null, callbackFailed: boolean): Promise<void> {
        if (callbackFailed) {
            loginError.value = { error: new LoginStateError() };
            await leaveCallback();
            return;
        }
        if (callbackQuery) {
            try {
                const path = await auth.completePageLogin(callbackQuery);
                await leaveCallback(path);
            } catch (error) {
                if (error instanceof BackendProblem && error.slug === 'oauth-code-invalid' && auth.claimLoginRetry()) {
                    await leaveCallback();
                    await pageLogin('/');
                    return;
                }
                loginError.value = { error };
                await leaveCallback();
            }
            return;
        }
        if (auth.info()) return;
        if (auth.recentPageLogin()) {
            loginError.value = { error: new LoginLoop() };
            return;
        }
        await pageLogin(router.currentRoute.value.fullPath);
    }

    async function pageLogin(returnPath: string): Promise<void> {
        try {
            await auth.startPageLogin(returnPath);
        } catch (error) {
            loginError.value = { error };
        }
    }

    let started: Promise<void> | null = null;

    function start(): Promise<void> {
        started ??= run();
        return started;
    }

    async function run(): Promise<void> {
        await router.isReady();
        const route = router.currentRoute.value;
        let callbackQuery: Record<string, unknown> | null = null;
        let callbackFailed = false;
        if (isCallbackPath(route.path)) {
            onCallback.value = true;
            const query = { ...route.query };
            // Still the callback route (the loading line says the login is finishing), only without the query.
            await router.replace(`/${CALLBACK_PATH}`);
            const handled = forwardPopupCallback(query, deps.callbackWindow);
            // A login popup: the opener exchanges the code; this window closes and shows nothing else.
            if (handled === 'forwarded' || handled === 'closed') return;
            if (handled === 'page') callbackQuery = query;
            else callbackFailed = true;
        }

        const found = await readChurchTools();
        if (found === null) {
            await leaveCallback();
            loading.value = false;
            return;
        }
        auth.configure({ backendUrl: found.backendUrl, clientId: found.clientId });
        auth.bindPerson(found.personId);
        // The login error, if any, is set before `loading` ends, so no role is ever shown in between.
        await login(callbackQuery, callbackFailed);
        loading.value = false;
    }

    async function reloadSettings(): Promise<void> {
        try {
            const read = await store.readSettings();
            if (read.state !== 'ok') return;
            const { backendUrl, oauthClientId } = settings.value ?? read.value;
            settings.value = { ...read.value, backendUrl, oauthClientId };
        } catch {
            // The settings of startup stay; the backend decides each request anyway.
        }
    }

    function loginAgain(): void {
        void auth.startPageLogin(router.currentRoute.value.fullPath).catch(() => undefined);
    }

    return {
        state,
        failure,
        settingsEditor,
        setupCapable,
        settings,
        personId,
        reloadSettings,
        storedSchema,
        appVersion: deps.appVersion,
        backendVersion: session.backendVersion,
        admin: session.admin,
        onCallback,
        start,
        loginAgain,
    };
}

export const APP_STATE_KEY: InjectionKey<AppStateHandle> = Symbol('app-state');

export function useAppState(): AppStateHandle {
    const handle = inject(APP_STATE_KEY, null);
    if (!handle) throw new Error('No app state provided');
    return handle;
}
