/**
 * The „Backend-Adresse“ field (spec 4.8): the rules of the store (`backendUrlProblem`, which mirrors the backend's
 * check) after the trailing slashes are removed, as the store and the backend normalize it.
 */
import { backendUrlProblem, newBackendUrlProblem, withoutTrailingSlashes, type BackendUrlProblem } from '../model/schemas';

/** `invisible`, `host-encoding`: allowed in a stored address (read like the backend does), never in a new one. */
export type BackendUrlResult = { ok: true; url: string } | { ok: false; reason: BackendUrlProblem | 'invisible' | 'host-encoding' };

export function normalizeBackendUrl(input: string): BackendUrlResult {
    const url = withoutTrailingSlashes(input);
    // The input first, so „https://“ alone is an incomplete address rather than a wrong scheme.
    const reason = backendUrlProblem(input) ?? backendUrlProblem(url) ?? newBackendUrlProblem(url);
    return reason === null ? { ok: true, url } : { ok: false, reason };
}
