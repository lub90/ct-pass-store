import { SECRET_KEY } from '../../scripts/sanitize-fixture.js';

/**
 * Makes a response body safe for an assertion or error message (port of the backend's `Redact` helper): JSON only,
 * every value under a secret key (the sanitizer's `SECRET_KEY`: token, secret, password, pwd, code, csrf, cookie,
 * authorization, session, jwt, key; any case) blanked at any depth, cut to 300 characters; anything that isn't JSON
 * becomes a placeholder, so no part of it is shown.
 */
const MAX = 300;
const SECRET = SECRET_KEY;

function blank(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(blank);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET.test(k) ? '…' : blank(v)]));
}

export function redactBody(body: string): string {
    let data: unknown;
    try {
        data = JSON.parse(body);
    } catch {
        return `<non-JSON body, ${body.length} characters>`;
    }
    if (data === null || typeof data !== 'object') return `<JSON scalar, ${body.length} characters>`;
    return JSON.stringify(blank(data)).slice(0, MAX);
}
