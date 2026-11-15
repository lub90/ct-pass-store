import type { BackendApi } from '@/backend/api';
import { BackendProblem } from '@/backend/problems';

/** How a rate-limited call waits; a parameter so the unit tests don't wait. */
export type Wait = (seconds: number) => Promise<void>;

const waitSeconds: Wait = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000));

/**
 * Sends `call`; an `upstream-rate-limited` answer of the backend is waited out (its `retryAfter`, 60 s without one, at
 * most 90 s) and the call sent again, twice at most (3 attempts). Any other error is rethrown at once, and the error of
 * the last attempt is passed on unchanged.
 */
export async function patiently<T>(call: () => Promise<T>, wait: Wait = waitSeconds, onWait: () => void = () => undefined): Promise<T> {
    for (let retry = 0; ; retry++) {
        try {
            return await call();
        } catch (e) {
            if (retry >= 2 || !(e instanceof BackendProblem) || e.slug !== 'upstream-rate-limited') throw e;
            onWait();
            await wait(Math.min(e.retryAfter ?? 60, 90));
        }
    }
}

/**
 * `api` with its entry and self-test calls sent `patiently`, except:
 * - `login`: the first try uses up the code;
 * - a `putEntry`/`deleteEntry` with a primary password other than `primaryPwd` (a deliberately wrong one): it is sent
 *   once, so a rate limit fails the case instead of adding failed ChurchTools logins for the shared test user.
 *
 * Resending a PUT or DELETE on `upstream-rate-limited` is safe only because the backend answers that before it writes:
 * it checks the primary password (`POST /login` at ChurchTools) first, and a rate-limited KV write is refused by
 * ChurchTools as a whole. A retried call with the right password may still count as one failed attempt in the
 * backend's limiter (5 in 15 minutes); a success resets it.
 */
export function patientApi(api: BackendApi, primaryPwd: string | null, wait: Wait = waitSeconds, onWait: () => void = () => undefined): BackendApi {
    const resendable = (pwd: string | undefined) => pwd === undefined || pwd === primaryPwd;
    const p = <T>(call: () => Promise<T>) => patiently(call, wait, onWait);
    return {
        ...api,
        getEntry: (id) => p(() => api.getEntry(id)),
        putEntry: (id, body) => (resendable(body.primaryPwd) ? p(() => api.putEntry(id, body)) : api.putEntry(id, body)),
        deleteEntry: (id, pwd) => (resendable(pwd) ? p(() => api.deleteEntry(id, pwd)) : api.deleteEntry(id, pwd)),
        selfTest: (write) => p(() => api.selfTest(write)),
    };
}
