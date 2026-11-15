/**
 * Keeping the backend session alive (spec 7.2): proactive renewal in click handlers, one retry after
 * `token-expired`, and the „Sitzung erneuern“ state when the popup can't do its job. Nothing typed is ever reset here.
 */
import { inject, ref, type InjectionKey, type Ref } from 'vue';
import { PersonMismatch, PopupBlocked, PopupClosed, type Auth } from '../backend/auth';
import { BackendProblem } from '../backend/problems';

/** Renew when less than this is left (spec 7.2: „fewer than 2 minutes“). */
export const RENEW_BEFORE_MS = 120_000;

export type SessionAuth = Pick<
    Auth,
    'loginInPopup' | 'startPageLogin' | 'clear' | 'info' | 'expiresInMs' | 'subscribe' | 'scope' | 'recentPageLogin'
>;

/**
 * A token problem right after a page login (or a renewal for another person then): logging in again would loop.
 * The app shows its `backend-error` state.
 */
export class LoginLoop extends Error {
    constructor() {
        super('The login does not hold; not logging in again');
        this.name = 'LoginLoop';
    }
}

export interface Session {
    /**
     * Display only (which frame to draw). Never a source of authorization: the backend decides every request from the
     * token. Reset when backend or person change, kept while a token is merely dropped.
     */
    admin: Ref<boolean>;
    /** Display only, like `admin`. */
    backendVersion: Ref<string | null>;
    /** True after a token problem right after a page login (`LoginLoop`); the app shows `backend-error`. */
    loginLoop: Ref<boolean>;
    /** True after the popup was blocked or closed, or the token became unusable while a form had input. */
    needsRenewal: Ref<boolean>;
    /** Renews through the popup if less than 120 s are left. Call it inside a click handler. */
    ensureFresh(): Promise<void>;
    /** Popup login (the „Sitzung erneuern“ button; overlapping calls share one popup). */
    renew(): Promise<void>;
    /** Runs a backend request; on `token-expired` renews through the popup and runs it exactly once more. */
    call<T>(fn: () => Promise<T>): Promise<T>;
    /** A form reports whether it holds unsaved input; returns the function that stops tracking. */
    trackUnsaved(hasUnsaved: () => boolean): () => void;
}

/** `currentPath` is the router path to come back to after a page login. */
export function createSession(auth: SessionAuth, currentPath: () => string): Session {
    const admin = ref(false);
    const backendVersion = ref<string | null>(null);
    const needsRenewal = ref(false);
    const loginLoop = ref(false);
    const unsaved = new Set<() => boolean>();
    let renewing: Promise<void> | null = null;

    // Follow the usable token: after configure(), bindPerson(), a page login and a renewal. A dropped token keeps the
    // last values, so the frame stays while a renewal is pending; another backend or person resets them.
    let scope = auth.scope();
    const takeInfo = (): void => {
        const now = auth.scope();
        if (now !== scope) {
            scope = now;
            admin.value = false;
            backendVersion.value = null;
        }
        const info = auth.info();
        if (!info) return;
        admin.value = info.admin;
        backendVersion.value = info.version;
    };
    takeInfo();
    auth.subscribe(takeInfo);

    /** A full login, unless one just completed (then `LoginLoop`). Never settles otherwise: the page leaves. */
    function pageLogin(): Promise<never> {
        if (auth.recentPageLogin()) {
            loginLoop.value = true;
            return Promise.reject(new LoginLoop());
        }
        return auth.startPageLogin(currentPath());
    }

    function renew(): Promise<void> {
        renewing ??= auth
            .loginInPopup()
            .then(
                () => {
                    needsRenewal.value = false;
                },
                (error: unknown) => {
                    if (error instanceof PopupBlocked || error instanceof PopupClosed) needsRenewal.value = true;
                    // Someone else is logged into ChurchTools now: what is on the page belongs to the previous person,
                    // so the page is reloaded through a full login rather than resending anything.
                    if (error instanceof PersonMismatch) return pageLogin();
                    throw error;
                },
            )
            .finally(() => {
                renewing = null;
            });
        return renewing;
    }

    async function ensureFresh(): Promise<void> {
        if (auth.expiresInMs() < RENEW_BEFORE_MS) await renew();
    }

    async function call<T>(fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            if (!(error instanceof BackendProblem)) throw error;
            if (error.slug === 'token-expired') {
                await renew();
                return fn();
            }
            if (error.slug === 'invalid-token' || error.slug === 'missing-token') {
                auth.clear();
                if ([...unsaved].some((hasUnsaved) => hasUnsaved())) {
                    needsRenewal.value = true;
                    throw error;
                }
                return pageLogin();
            }
            throw error;
        }
    }

    function trackUnsaved(hasUnsaved: () => boolean): () => void {
        unsaved.add(hasUnsaved);
        return () => void unsaved.delete(hasUnsaved);
    }

    return { admin, backendVersion, loginLoop, needsRenewal, ensureFresh, renew, call, trackUnsaved };
}

export const SESSION_KEY: InjectionKey<Session> = Symbol('session');

export function useSession(): Session {
    const session = inject(SESSION_KEY, null);
    if (!session) throw new Error('No session provided');
    return session;
}
