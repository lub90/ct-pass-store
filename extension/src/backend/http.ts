import { BackendUnreachable, UnexpectedResponse, isProgrammingError, problemFromBody } from './problems';

/** Per request, covering the answer's body too (spec 7.3). */
export const TIMEOUT_MS = 15_000;

/** `settings.backendUrl` without trailing slashes, plus `/v1`. */
export function backendBase(url: string): string {
    return `${url.trim().replace(/\/+$/, '')}/v1`;
}

export interface RequestOptions {
    body?: unknown;
    /** Send the bearer token (default). Login sends none. */
    auth?: boolean;
}

export interface HttpAnswer {
    status: number;
    /** `undefined` for `204`. */
    body: unknown;
}

const mediaType = (response: Response): string => (response.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();

/**
 * One JSON request. Resolves for 2xx with the parsed body. Rejects with `BackendProblem` (a problem answer),
 * `UnexpectedResponse` (anything else that is off) or `BackendUnreachable` (network, CORS, timeout).
 */
export function createHttp(base: string, token: () => string | null) {
    return async function request(method: string, path: string, options: RequestOptions = {}): Promise<HttpAnswer> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        const bearer = options.auth === false ? null : token();
        if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
        let body: string | undefined;
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.body);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let response: Response;
        let text: string;
        try {
            response = await fetch(`${base}${path}`, {
                method,
                headers,
                body,
                signal: controller.signal,
                credentials: 'omit',
                cache: 'no-store',
                redirect: 'error',
            });
            text = response.status === 204 ? '' : await response.text();
        } catch {
            // Deliberately without the cause: nothing of the request may end up in an error.
            throw new BackendUnreachable();
        } finally {
            clearTimeout(timer);
        }

        const { status } = response;
        if (status >= 200 && status < 300) {
            if (status === 204) return { status, body: undefined };
            if (mediaType(response) !== 'application/json') throw new UnexpectedResponse(status);
            return { status, body: parseJson(text, status) };
        }

        if (mediaType(response) !== 'application/problem+json') throw new UnexpectedResponse(status);
        const problem = problemFromBody(status, parseJson(text, status));
        if (!problem) throw new UnexpectedResponse(status);
        if (isProgrammingError(problem)) console.error(`Backend rejected a request: ${problem.slug} (HTTP ${status})`);
        throw problem;
    };
}

function parseJson(text: string, status: number): unknown {
    try {
        return JSON.parse(text);
    } catch {
        throw new UnexpectedResponse(status);
    }
}

