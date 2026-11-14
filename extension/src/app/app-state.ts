/**
 * The app state of spec 3.2 as a pure function, and the role-derived parts of the frame (E3, spec 3.1, 4.1).
 *
 * None of this authorizes anything: the backend decides every request from its token and ChurchTools every KV write
 * from its rights. These values only choose what to draw.
 */
import { LoginStateError, LoginUnavailable, PersonMismatch } from '../backend/auth';
import { BackendProblem, UnexpectedResponse, problemMessageKey } from '../backend/problems';
import { CtRateLimitedError } from '../ct/errors';
import type { CtCategory, Permissions } from '../ct/types';
import type { SettingsV2 } from '../model/schemas';
import type { Read } from '../store/repository';
import { LoginLoop } from './useSession';
import { sameMajorMinor } from './version';

export type AppState =
    | 'loading'
    | 'no-access'
    | 'migration-needed'
    | 'update-needed'
    | 'setup-needed'
    | 'backend-error'
    | 'version-mismatch'
    | 'user'
    | 'admin';

/** Result of the backend login: rows 6 and 7. */
export type LoginOutcome = 'ok' | 'no-service-access' | 'failed';

export interface AppStateInputs {
    /** Row 1: startup hasn't decided yet (also while a page login is under way). */
    loading: boolean;
    /** Row 2: `whoami` is anonymous. */
    anonymous: boolean;
    /** Row 2: the extension's `view` permission; `null` when the rights couldn't be read (then `ctFailed`). */
    view: boolean | null;
    /**
     * ChurchTools couldn't be read (KV store, rights): rows 3 to 5 are unknown. An outage must not look like „not set
     * up“, so this is `backend-error`, right after row 2.
     */
    ctFailed: boolean;
    /** Row 3 (spec 6.3). */
    oldLayout: boolean;
    /** Row 4: `settings` or `access` has a newer `schema`. */
    newerSchema: boolean;
    /** Row 5: `settings` ok, with `backendUrl` and `oauthClientId`. */
    settingsReady: boolean;
    /** Rows 6 and 7. */
    login: LoginOutcome;
    /** Row 8: from the login answer; `null` without one. */
    backendVersion: string | null;
    appVersion: string;
    /** Rows 9 and 10: the login answer's `admin` (display only). */
    admin: boolean;
}

/** Spec 3.2: the first row that matches wins. */
export function computeAppState(i: AppStateInputs): AppState {
    if (i.loading) return 'loading';
    if (i.anonymous || i.view === false) return 'no-access';
    if (i.ctFailed) return 'backend-error';
    // Fail closed: rights not known without a recorded failure never pass.
    if (i.view !== true) return 'no-access';
    if (i.oldLayout) return 'migration-needed';
    if (i.newerSchema) return 'update-needed';
    if (!i.settingsReady) return 'setup-needed';
    if (i.login === 'no-service-access') return 'no-access';
    if (i.login === 'failed') return 'backend-error';
    // Fail closed: a login without a version (or with a malformed one) never gets a role.
    if (i.backendVersion === null || !sameMajorMinor(i.appVersion, i.backendVersion)) return 'version-mismatch';
    return i.admin ? 'admin' : 'user';
}

/** `null`: the login worked. Only the backend's `no-service-access` is row 6; everything else is row 7. */
export function loginOutcome(error: unknown): LoginOutcome {
    if (error === null) return 'ok';
    if (error instanceof BackendProblem && error.slug === 'no-service-access') return 'no-service-access';
    return 'failed';
}

/** Row 5 negated: `settings` readable, with a backend address and an OAuth client id. */
export function settingsReady(read: Read<SettingsV2>): boolean {
    if (read.state !== 'ok') return false;
    return !!read.value.backendUrl && !!read.value.oauthClientId;
}

/** Which settings categories the person may change (spec 3.1 row 3). */
export interface SettingsEditor {
    settings: boolean;
    access: boolean;
}

/** `edit custom data` on the categories named `settings` and `access`, matched by id. */
export function settingsEditorFrom(permissions: Permissions, categories: readonly CtCategory[]): SettingsEditor {
    const can = (name: string): boolean => {
        const category = categories.find((c) => c.name === name);
        return category !== undefined && permissions['edit custom data'].includes(category.id);
    };
    return { settings: can('settings'), access: can('access') };
}

export const isSettingsEditor = (e: SettingsEditor): boolean => e.settings || e.access;

/** Provisional (spec 5.2): the wizard spec replaces this with its full list of rights. */
export function setupCapableFrom(permissions: Permissions): boolean {
    return permissions['create custom category'] === true;
}

export type NavPath = '/' | '/manage' | '/settings' | '/about';

/** The frame by role (E3): the card for normal users, the sidebar when there is more than one page to reach. */
export function frameFor(state: AppState, editor: SettingsEditor): { mode: 'card' | 'sidebar'; nav: NavPath[] } {
    if (state === 'admin') return { mode: 'sidebar', nav: ['/', '/manage', '/settings', '/about'] };
    if (state === 'user' && isSettingsEditor(editor)) return { mode: 'sidebar', nav: ['/', '/settings', '/about'] };
    // Spec 3.1.2: a broken backend can always be fixed by someone with the right.
    if (state === 'backend-error' && isSettingsEditor(editor)) return { mode: 'sidebar', nav: ['/', '/settings'] };
    return { mode: 'card', nav: [] };
}

const isSettingsPath = (path: string): boolean => path === '/settings' || path.startsWith('/settings/');

/** Whether the route's page is drawn; otherwise the state's own view is. No page renders before the state allows it. */
export function showsRoute(state: AppState, editor: SettingsEditor, path: string): boolean {
    if (state === 'user' || state === 'admin') return true;
    return state === 'backend-error' && isSettingsEditor(editor) && isSettingsPath(path);
}

/** The nav entry of a path (`/manage/5` → `/manage`), whole segments only; the path itself when none matches. */
export function currentNav(path: string, nav: readonly string[]): string {
    let best: string | undefined;
    for (const to of nav) {
        const match = to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
        if (match && (best === undefined || to.length > best.length)) best = to;
    }
    return best ?? path;
}

/** Why the state is `backend-error`: ChurchTools couldn't be read, or the backend login failed. */
export type Failure = { kind: 'churchtools'; error: unknown } | { kind: 'login'; error: unknown };

export interface FailureMessage {
    /** i18n key. */
    key: string;
    params: { status?: number; n?: number };
    /** Offer „Erneut anmelden“. */
    loginAction: boolean;
    /** The backend's technical `detail` (English), plain text, only for settings editors (spec 8.2). */
    detail?: string;
}

const minutes = (seconds: number): number => Math.min(60, Math.max(1, Math.ceil(seconds / 60)));

/** The login itself broke (not the backend): spec 8.2 „Die Anmeldung hat nicht geklappt“, for everyone. */
function isLoginFlowError(error: unknown): boolean {
    return (
        error instanceof LoginLoop ||
        error instanceof LoginStateError ||
        error instanceof PersonMismatch ||
        error instanceof LoginUnavailable ||
        (error instanceof BackendProblem && error.slug === 'oauth-code-invalid')
    );
}

/**
 * The text of a `backend-error`. `detailed`: the person is a settings editor (spec 3.2 row 7) and sees the problem
 * text; everyone else only that the service is unreachable.
 */
export function failureMessage(failure: Failure, detailed: boolean): FailureMessage {
    const { error } = failure;
    if (failure.kind === 'churchtools') {
        if (error instanceof CtRateLimitedError) return { key: 'state.ctRateLimited', params: { n: minutes(error.retryAfterMs / 1000) }, loginAction: false };
        return { key: 'state.ctUnavailable', params: {}, loginAction: false };
    }
    if (isLoginFlowError(error)) return { key: 'problems.loginFailed', params: {}, loginAction: true };
    if (!detailed) return { key: 'state.unavailable', params: {}, loginAction: true };
    const params: FailureMessage['params'] = {};
    if (error instanceof BackendProblem || error instanceof UnexpectedResponse) params.status = error.status;
    if (error instanceof BackendProblem && error.status === 429) params.n = minutes(error.retryAfter ?? 0);
    const message: FailureMessage = { key: problemMessageKey(error), params, loginAction: true };
    if (error instanceof BackendProblem && typeof error.detail === 'string' && error.detail !== '') message.detail = error.detail;
    return message;
}
