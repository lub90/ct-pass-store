/** PKCE (RFC 7636, S256) and the ChurchTools authorize URL (spec 7.1). Nothing here is logged or stored. */

/** Base64url without padding (RFC 4648 section 5). */
export function base64url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 bytes (256 bits) from `crypto.getRandomValues` as 43 base64url characters; used for `state` and the verifier. */
export function randomToken(): string {
    return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** `base64url(SHA-256(verifier))`. */
export async function challengeFor(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
}

/** A verifier of 43 characters from the unreserved set and its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
    const verifier = randomToken();
    return { verifier, challenge: await challengeFor(verifier) };
}

/** `<origin>/oauth/authorize` with `scope=api` and an S256 challenge. Only the origin of `origin` is used. */
export function authorizeUrl(origin: string, clientId: string, redirectUri: string, state: string, challenge: string): string {
    const url = new URL('/oauth/authorize', new URL(origin).origin);
    url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'api',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    }).toString();
    return url.toString();
}
