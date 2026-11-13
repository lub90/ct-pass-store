/** Errors of the ChurchTools layer. Callers never see axios errors, only these (or a network error, unchanged). */

/** Nobody is logged in: `401`, or `whoami` answered with id -1 / 0 (anonymous). */
export class NotAuthenticatedError extends Error {
    constructor(message = 'Not logged in to ChurchTools') {
        super(message);
        this.name = 'NotAuthenticatedError';
    }
}

/** `403`: a right is missing. `missing` names it when the call knows which one it was. */
export class CtForbiddenError extends Error {
    missing?: string;
    constructor(message = 'Forbidden by ChurchTools', missing?: string) {
        super(message);
        this.name = 'CtForbiddenError';
        this.missing = missing;
    }
}

/** `429`: wait `retryAfterMs` (at least 60 s) before the next request. */
export class CtRateLimitedError extends Error {
    retryAfterMs: number;
    constructor(retryAfterMs: number) {
        super(`ChurchTools rate limit reached, retry in ${Math.ceil(retryAfterMs / 1000)} s`);
        this.name = 'CtRateLimitedError';
        this.retryAfterMs = retryAfterMs;
    }
}

/** Any other HTTP failure (`400`, `404`, `5xx`, ...). */
export class CtHttpError extends Error {
    status: number;
    constructor(status: number, message?: string) {
        super(message ?? `ChurchTools answered ${status}`);
        this.name = 'CtHttpError';
        this.status = status;
    }
}
