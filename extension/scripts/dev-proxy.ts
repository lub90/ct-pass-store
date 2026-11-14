/**
 * The development proxy for `npm run dev -- --mode real` (spec 13.6): `/api` goes to the ChurchTools instance with
 * `Authorization: Login <token>`, so the browser never sees the credentials. `CT_BASE_URL` and `CT_LOGIN_TOKEN` have
 * no `VITE_` prefix and are read only here, by `vite.config.ts`; they never reach the bundle.
 */

/**
 * The only prefix Vite exposes to the app as `import.meta.env.*`. Nothing uses it; it replaces the default `VITE_`,
 * so variables from an old `.env` (`VITE_PASSWORD`, ...) can never be inlined into a build.
 */
export const ENV_PREFIX = 'CPS_PUBLIC_';

export interface ProxyRule {
    target: string;
    changeOrigin: true;
    headers: { Authorization: string };
}

/** `undefined` except in mode `real`; there it throws unless both variables are usable. Errors never repeat the values. */
export function devProxy(mode: string, env: Record<string, string | undefined>): Record<string, ProxyRule> | undefined {
    if (mode !== 'real') return undefined;
    let url: URL;
    try {
        url = new URL(env.CT_BASE_URL ?? '');
    } catch {
        throw new Error('--mode real needs CT_BASE_URL in .env (an https:// address of the ChurchTools instance)');
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw new Error('CT_BASE_URL must be an https:// address without user name or password');
    }
    const token = env.CT_LOGIN_TOKEN?.trim() ?? '';
    if (token === '') throw new Error('--mode real needs CT_LOGIN_TOKEN in .env (a ChurchTools login token)');
    return { '/api': { target: url.origin, changeOrigin: true, headers: { Authorization: `Login ${token}` } } };
}
