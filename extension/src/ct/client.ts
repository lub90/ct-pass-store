import { ChurchToolsClient } from '@churchtools/churchtools-client';

const MIN_RETRY_MS = 60_000;

/**
 * The ChurchTools base URL: `window.settings.base_url` inside ChurchTools, the page origin otherwise (then the dev
 * proxy forwards `/api`). No instance URL is ever part of the bundle.
 */
export function instanceBaseUrl(): string {
    const settings = (window as { settings?: { base_url?: string } }).settings;
    return settings?.base_url || window.location.origin;
}

function header(headers: unknown, name: string): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    const withGet = headers as { get?: (n: string) => unknown };
    if (typeof withGet.get === 'function') {
        const v = withGet.get(name);
        if (typeof v === 'string') return v;
    }
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === name && typeof value === 'string') return value;
    }
    return undefined;
}

/**
 * How long to wait after a `429`. `Retry-After` may be seconds or an HTTP date, and ChurchTools doesn't necessarily
 * send it. Never below 60 s, the minimum ChurchTools advises (spec ct-extension-info.md, section 7).
 */
export function retryAfterMs(response: { headers?: unknown }, now: number = Date.now()): number {
    const raw = header(response.headers, 'retry-after')?.trim();
    if (!raw) return MIN_RETRY_MS;
    let ms: number;
    if (/^\d+$/.test(raw)) ms = Number(raw) * 1000;
    else {
        const at = Date.parse(raw);
        ms = Number.isNaN(at) ? 0 : at - now;
    }
    return Math.max(MIN_RETRY_MS, ms);
}

/**
 * The one ChurchTools client of the app. Paths passed to it start with `/` and omit `/api` (the client builds
 * `${baseUrl}/api${path}` and strips a trailing slash from the base URL).
 *
 * CSRF: `setLoadCSRFForAPI()` (client >= 1.7.1) makes every REST write fetch `GET /csrftoken` once and send it as
 * `CSRF-Token`. ChurchTools doesn't require it for REST writes yet, but may; sending it is harmless, so it is on.
 */
export function createClient(baseUrl: string = instanceBaseUrl()): ChurchToolsClient {
    const client = new ChurchToolsClient();
    client.setBaseUrl(baseUrl);
    client.setLoadCSRFForAPI();
    return client;
}
