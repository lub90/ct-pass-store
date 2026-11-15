/**
 * The development proxy for `npm run dev -- --mode real` (spec 13.6): `/api` goes to the ChurchTools instance with
 * `Authorization: Login <token>`, so the browser never sees the credentials. `CT_BASE_URL` and `CT_LOGIN_TOKEN` have
 * no `VITE_` prefix and are read only here, by `vite.config.ts`; they never reach the bundle.
 *
 * The proxy acts with the token's rights, so it serves only the dev server's own page: a request from another site
 * (any page the developer visits can send a simple cross-site POST to localhost) or through a foreign host name (DNS
 * rebinding) is refused with a 404 before it is forwarded, and the token is added only to requests that pass.
 */
import type { IncomingHttpHeaders } from 'node:http';
import type { Plugin, ProxyOptions } from 'vite';

/**
 * The only prefix Vite exposes to the app as `import.meta.env.*`. Nothing uses it; it replaces the default `VITE_`,
 * so variables from an old `.env` (`VITE_PASSWORD`, ...) can never be inlined into a build.
 */
export const ENV_PREFIX = 'CPS_PUBLIC_';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The host part of a `Host` header (`localhost:5173` → `localhost`), or `null`. */
function hostName(host: string | undefined): string | null {
    if (!host) return null;
    try {
        const url = new URL(`http://${host}`);
        return url.host === host.toLowerCase() ? url.hostname : null;
    } catch {
        return null;
    }
}

/**
 * Why the proxy refuses a request, or `null` when it comes from the dev server's own page: the `Host` is a loopback
 * name, `Sec-Fetch-Site` (if sent) is `same-origin`, and `Origin` (if sent) is the dev server itself.
 */
export function proxyRefusal(headers: IncomingHttpHeaders): 'host' | 'cross-site' | 'origin' | null {
    const host = typeof headers.host === 'string' ? headers.host : undefined;
    const name = hostName(host);
    if (name === null || !LOOPBACK.has(name)) return 'host';
    const site = headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return 'cross-site';
    const origin = headers.origin;
    if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) return 'origin';
    return null;
}

/** `server.host` keeps the dev server on this machine: unset (Vite's default `localhost`) or a loopback address. */
export function loopbackServerHost(host: string | boolean | undefined): boolean {
    return host === undefined || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Stops the dev server in real mode when it listens beyond this machine (`--host`, `0.0.0.0`). */
export function realModeGuard(): Plugin {
    return {
        name: 'cps-real-mode-guard',
        configureServer(server) {
            if (!loopbackServerHost(server.config.server.host)) {
                throw new Error('--mode real runs only on a loopback dev server (no --host): the proxy carries a ChurchTools login token');
            }
        },
    };
}

/** `undefined` except in mode `real`; there it throws unless both variables are usable. Errors never repeat the values. */
export function devProxy(mode: string, env: Record<string, string | undefined>): Record<string, ProxyOptions> | undefined {
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
    return {
        '/api': {
            target: url.origin,
            changeOrigin: true,
            // `false`: Vite answers 404 and forwards nothing.
            bypass: (req) => (proxyRefusal(req.headers) === null ? undefined : false),
            configure: (proxy) => {
                proxy.on('proxyReq', (proxyReq, req) => {
                    // The browser's own ChurchTools cookie and origin don't travel; the token is the only credential.
                    proxyReq.removeHeader('cookie');
                    proxyReq.removeHeader('origin');
                    // Checked again here, so the token can never reach a refused request.
                    if (proxyRefusal(req.headers) !== null) {
                        proxyReq.destroy();
                        return;
                    }
                    proxyReq.setHeader('Authorization', `Login ${token}`);
                });
            },
        },
    };
}
