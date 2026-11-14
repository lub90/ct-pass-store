/**
 * Keeping the backend session alive (spec 7.2): proactive renewal in click handlers, one retry after
 * `token-expired`, and the „Sitzung erneuern“ state when the popup can't do its job. Nothing typed is ever reset here.
 */
import { inject, ref, type InjectionKey, type Ref } from 'vue';
import { PopupBlocked, PopupClosed, type Auth } from '../backend/auth';
import { BackendProblem } from '../backend/problems';

/** Renew when this much or less is left. */
export const RENEW_BEFORE_MS = 120_000;

export type SessionAuth = Pick<Auth, 'loginInPopup' | 'startPageLogin' | 'clear' | 'info' | 'expiresInMs'>;

export interface Session {
    admin: Ref<boolean>;
    backendVersion: Ref<string | null>;
    /** True after the popup was blocked or closed, or the token became unusable while a form had input. */
    needsRenewal: Ref<boolean>;
    /** Renews through the popup if 120 s or less are left. Call it inside a click handler. */
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
    const unsaved = new Set<() => boolean>();
    let renewing: Promise<void> | null = null;

    // Role and version change only with a new login, so the frame stays while a renewal is pending.
    const takeInfo = (): void => {
        const info = auth.info();
        admin.value = info?.admin ?? false;
        backendVersion.value = info?.version ?? null;
    };
    takeInfo();

    function renew(): Promise<void> {
        renewing ??= auth
            .loginInPopup()
            .then(
                () => {
                    needsRenewal.value = false;
                    takeInfo();
                },
                (error: unknown) => {
                    if (error instanceof PopupBlocked || error instanceof PopupClosed) needsRenewal.value = true;
                    throw error;
                },
            )
            .finally(() => {
                renewing = null;
            });
        return renewing;
    }

    async function ensureFresh(): Promise<void> {
        if (auth.expiresInMs() <= RENEW_BEFORE_MS) await renew();
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
                return auth.startPageLogin(currentPath());
            }
            throw error;
        }
    }

    function trackUnsaved(hasUnsaved: () => boolean): () => void {
        unsaved.add(hasUnsaved);
        return () => void unsaved.delete(hasUnsaved);
    }

    return { admin, backendVersion, needsRenewal, ensureFresh, renew, call, trackUnsaved };
}

export const SESSION_KEY: InjectionKey<Session> = Symbol('session');

export function useSession(): Session {
    const session = inject(SESSION_KEY, null);
    if (!session) throw new Error('No session provided');
    return session;
}
