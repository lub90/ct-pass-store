import { createHash, randomBytes } from 'node:crypto';
import { CtSession } from './ct-session';
import { redactBody } from './redact';
import type { ContractEnv, FixtureUser } from './setup';

/** What one authorization gives the extension: the code and the verifier to exchange it with. */
export interface OAuthCode {
    code: string;
    state: string;
    codeVerifier: string;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Plays the browser's part of the authorization code flow (port of the backend's `OAuthCodeFetcher`): logs in as the
 * user in a session of its own (or uses `loggedIn`, the user's session, so a run doesn't log in for every code), calls `/oauth/authorize` with PKCE (S256) and, if the consent page appears, approves
 * it. The redirect to the redirect URI is never followed; `code` and `state` are read from its `Location`.
 */
export async function fetchOAuthCode(env: ContractEnv, user: FixtureUser, clientId: string, redirectUri: string, loggedIn?: CtSession): Promise<OAuthCode> {
    const session = loggedIn ?? (await new CtSession(env).login(user));
    const codeVerifier = b64url(randomBytes(48));
    const state = randomBytes(8).toString('hex');
    const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'api',
        state,
        code_challenge: b64url(createHash('sha256').update(codeVerifier).digest()),
        code_challenge_method: 'S256',
    });

    let answer = await session.request('GET', `${env.root}/oauth/authorize?${query}`, { headers: { Accept: 'text/html' } });
    for (let hops = 0; hops < 6; hops++) {
        const location = answer.headers.get('Location') ?? '';
        if (location !== '' && location.split('?', 1)[0] === redirectUri) return { ...parse(location, state), codeVerifier };
        if (location !== '') {
            answer = await session.request('GET', new URL(location, env.root).href, { headers: { Accept: 'text/html' } });
            continue;
        }
        // The consent page (a Vue page) carries the authorize query in `window.grantPermissionData`; its approve button
        // POSTs it to /oauth/authorize_granted with grant_access=1 and the session's CSRF token.
        const match = /grantPermissionData\s*=\s*(\{.*?\});/s.exec(answer.text);
        if (answer.status !== 200 || !match) {
            throw new Error(`OAuth: the authorize step answered ${answer.status} without a redirect or a consent page (${redactBody(answer.text)}).`);
        }
        const data = JSON.parse(match[1]!) as { queryParams?: Record<string, string> };
        const params = new URLSearchParams(data.queryParams ?? {});
        answer = await session.request('POST', `${env.root}/oauth/authorize_granted?${params}`, {
            form: { grant_access: '1', 'CSRF-Token': await session.csrfToken() },
            headers: { Accept: 'text/html' },
        });
    }
    throw new Error('OAuth: no redirect to the redirect URI after 6 steps.');
}

function parse(location: string, expectedState: string): { code: string; state: string } {
    const params = new URL(location).searchParams;
    const code = params.get('code') ?? '';
    const state = params.get('state') ?? '';
    // Only the parameter names go into the message: the code itself is a credential.
    if (code === '' || state !== expectedState) throw new Error(`OAuth: the redirect has no code or a wrong state (${[...params.keys()].join(',')}).`);
    return { code, state };
}

/** `POST /oauth/access_token` as the backend does it; `clientSecret: null` leaves the secret out. */
export async function exchangeCode(env: ContractEnv, clientId: string, clientSecret: string | null, redirectUri: string, code: OAuthCode) {
    const form: Record<string, string> = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code: code.code, code_verifier: code.codeVerifier };
    if (clientSecret !== null) form.client_secret = clientSecret;
    return new CtSession(env).request('POST', `${env.root}/oauth/access_token`, { form });
}
