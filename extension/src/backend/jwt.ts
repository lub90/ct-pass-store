/**
 * The person a backend token was issued for: the decimal string `sub` of the JWT payload (backend `UserTokens`).
 * The signature is NOT checked; the backend does that. This only binds the stored token to the ChurchTools person
 * logged in now (`Auth.bindPerson`), so it never reads more than `sub`.
 */
export function tokenPerson(token: string): number | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let payload: unknown;
    try {
        const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
        payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
    } catch {
        return null;
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const sub = (payload as Record<string, unknown>).sub;
    if (typeof sub !== 'string' || !/^[1-9]\d{0,15}$/.test(sub)) return null;
    const id = Number(sub);
    return Number.isSafeInteger(id) ? id : null;
}
