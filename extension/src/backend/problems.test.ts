import { describe, expect, it } from 'vitest';
import de from '@/i18n/de';
import en from '@/i18n/en';
import { BackendConfigError, BackendProblem, BackendUnreachable, UnexpectedResponse, isProgrammingError, problemFromBody, problemMessageKey } from './problems';

const TYPE = 'https://github.com/lub90/ct-pass-store/blob/main/backend/docs/problems.md';

describe('problemFromBody', () => {
    it('reads slug, status, detail from a problem body; the HTTP status wins over the body', () => {
        const p = problemFromBody(404, { type: `${TYPE}#entry-not-found`, title: 'x', status: 500, detail: 'Person 1 has none.' });
        expect(p).toBeInstanceOf(BackendProblem);
        expect(p).toMatchObject({ slug: 'entry-not-found', status: 404, detail: 'Person 1 has none.' });
        expect(p?.violations).toBeUndefined();
        expect(p?.retryAfter).toBeUndefined();
    });

    it('takes the slug after the last "#"', () => {
        expect(problemFromBody(400, { type: 'https://x/a#b#invalid-id' })?.slug).toBe('invalid-id');
    });

    it.each([
        ['type without "#"', { type: `${TYPE}` }],
        ['empty slug', { type: `${TYPE}#` }],
        ['type is not a string', { type: 5 }],
        ['no type', { title: 'x' }],
        ['null', null],
        ['array', [{ type: `${TYPE}#forbidden` }]],
        ['string', 'forbidden'],
    ])('is not a problem: %s', (_name, body) => {
        expect(problemFromBody(400, body)).toBeNull();
    });

    it.each([
        ['upper case', '#Forbidden'],
        ['a space', '#a b'],
        ['markup', '#<script>'],
        ['a slash', '#a/b'],
        ['65 characters', `#${'a'.repeat(65)}`],
    ])('a slug with %s is not a problem', (_n, suffix) => {
        expect(problemFromBody(400, { type: `${TYPE}${suffix}` })).toBeNull();
    });

    it('accepts slugs of 1 and 64 characters', () => {
        expect(problemFromBody(400, { type: '#a' })?.slug).toBe('a');
        expect(problemFromBody(400, { type: `#${'a1-'.repeat(21)}a` })?.slug).toHaveLength(64);
    });

    it('ignores a detail that is not a string', () => {
        expect(problemFromBody(400, { type: '#invalid-id', detail: { a: 1 } })?.detail).toBeUndefined();
    });

    it('keeps violations as a list of strings and drops other things', () => {
        const type = `${TYPE}#password-invalid`;
        expect(problemFromBody(400, { type, violations: ['too-short', 'missing-digit'] })?.violations).toEqual(['too-short', 'missing-digit']);
        expect(problemFromBody(400, { type, violations: ['too-short', 3, null] })?.violations).toEqual(['too-short']);
        // Only the six documented codes survive, each once, in the order sent.
        expect(problemFromBody(400, { type, violations: ['too-short', 'made-up', 'too-short', '<b>x</b>', 'too-long'] })?.violations).toEqual([
            'too-short',
            'too-long',
        ]);
        for (const code of ['too-short', 'too-long', 'missing-letter', 'missing-digit', 'missing-symbol', 'invalid-character']) {
            expect(problemFromBody(400, { type, violations: [code] })?.violations, code).toEqual([code]);
        }
        expect(problemFromBody(400, { type, violations: [] })?.violations).toEqual([]);
        expect(problemFromBody(400, { type, violations: 'too-short' })?.violations).toBeUndefined();
        expect(problemFromBody(400, { type, violations: { 0: 'too-short' } })?.violations).toBeUndefined();
    });

    it('accepts retryAfter only as a finite, non-negative number', () => {
        const type = `${TYPE}#too-many-attempts`;
        expect(problemFromBody(429, { type, retryAfter: 120 })?.retryAfter).toBe(120);
        expect(problemFromBody(429, { type, retryAfter: 0 })?.retryAfter).toBe(0);
        for (const bad of ['120', 1.5, 0.1, -1, Number.NaN, Number.POSITIVE_INFINITY, null, [120], {}]) {
            expect(problemFromBody(429, { type, retryAfter: bad })?.retryAfter, String(bad)).toBeUndefined();
        }
        expect(problemFromBody(429, { type })?.retryAfter).toBeUndefined();
    });

    it('puts neither detail nor body content into the error message', () => {
        const p = problemFromBody(403, { type: '#invalid-primary-password', detail: 'secret-detail-123' });
        expect(p?.message).not.toContain('secret-detail-123');
        expect(p?.message).toContain('invalid-primary-password');
        expect(p?.message).toContain('403');
    });
});

describe('error classes', () => {
    it('have names and are Errors', () => {
        expect(new BackendProblem('x', 400).name).toBe('BackendProblem');
        expect(new BackendUnreachable().name).toBe('BackendUnreachable');
        expect(new BackendConfigError().name).toBe('BackendConfigError');
        const u = new UnexpectedResponse(502);
        expect(u.name).toBe('UnexpectedResponse');
        expect(u.status).toBe(502);
        expect(u.message).toContain('502');
        for (const e of [new BackendProblem('x', 400), new BackendUnreachable(), new BackendConfigError(), u]) expect(e).toBeInstanceOf(Error);
    });
});

const KEYS: Record<string, string> = {
    'entry-not-found': 'problems.entryNotFound',
    'primary-password-required': 'problems.primaryPasswordRequired',
    'invalid-primary-password': 'problems.invalidPrimaryPassword',
    'password-invalid': 'problems.passwordInvalid',
    'custom-password-not-allowed': 'problems.customPasswordNotAllowed',
    'too-many-attempts': 'problems.rateLimited',
    'upstream-rate-limited': 'problems.rateLimited',
    'token-expired': 'problems.session',
    'missing-token': 'problems.session',
    'invalid-token': 'problems.session',
    'no-service-access': 'problems.noServiceAccess',
    forbidden: 'problems.forbidden',
    'person-not-found': 'problems.personNotFound',
    'oauth-code-invalid': 'problems.loginFailed',
    'upstream-unavailable': 'problems.upstreamUnavailable',
    'upstream-invalid': 'problems.upstreamUnavailable',
    misconfigured: 'problems.notSetUp',
    'not-configured': 'problems.notSetUp',
    'internal-error': 'problems.generic',
    'invalid-id': 'problems.generic',
    'invalid-body': 'problems.generic',
    'not-found': 'problems.generic',
    'https-required': 'problems.generic',
    'method-not-allowed': 'problems.generic',
    'cleanup-running': 'problems.generic',
    'payload-too-large': 'problems.generic',
    'unsupported-media-type': 'problems.generic',
    'cleanup-too-soon': 'problems.generic',
    'already-configured': 'problems.generic',
    'setup-check-failed': 'problems.generic',
};

describe('problemMessageKey', () => {
    for (const [slug, key] of Object.entries(KEYS)) {
        it(`${slug} -> ${key}`, () => {
            expect(problemMessageKey(new BackendProblem(slug, 400))).toBe(key);
        });
    }

    it('an unknown slug and a non-backend error are generic; the two other errors have their own keys', () => {
        expect(problemMessageKey(new BackendProblem('something-new', 418))).toBe('problems.generic');
        expect(problemMessageKey(new BackendProblem('__proto__', 400))).toBe('problems.generic');
        expect(problemMessageKey(new BackendProblem('constructor', 400))).toBe('problems.generic');
        expect(problemMessageKey(new Error('x'))).toBe('problems.generic');
        expect(problemMessageKey('boom')).toBe('problems.generic');
        expect(problemMessageKey(new BackendUnreachable())).toBe('problems.unreachable');
        expect(problemMessageKey(new UnexpectedResponse(200))).toBe('problems.unexpected');
    });

    it('every key exists in de and en', () => {
        const get = (messages: unknown, key: string) =>
            key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
        for (const key of new Set([...Object.values(KEYS), 'problems.unreachable', 'problems.unexpected'])) {
            expect(typeof get(de, key), key).toBe('string');
            expect(typeof get(en, key), key).toBe('string');
        }
    });

    it('uses the texts of spec 8.2 verbatim', () => {
        expect(de.problems.entryNotFound).toBe('Noch kein Passwort');
        expect(de.problems.primaryPasswordRequired).toBe('Bitte gib dein ChurchTools-Passwort ein.');
        expect(de.problems.invalidPrimaryPassword).toBe('Das ChurchTools-Passwort stimmt nicht.');
        expect(de.problems.customPasswordNotAllowed).toBe('Eigene Passwörter sind gerade nicht erlaubt.');
        expect(de.problems.rateLimited).toBe('Zu viele Versuche. Versuch es in {n} Minuten noch einmal.');
        expect(de.problems.forbidden).toBe('Dafür hast du keine Berechtigung.');
        expect(de.problems.personNotFound).toBe('Diese Person gibt es in ChurchTools nicht mehr.');
        expect(de.problems.loginFailed).toBe('Die Anmeldung hat nicht geklappt. Lade die Seite neu.');
        expect(de.problems.upstreamUnavailable).toBe('ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.');
        expect(de.problems.notSetUp).toBe('Der Dienst ist noch nicht richtig eingerichtet.');
        expect(de.problems.generic).toBe('Etwas ist schiefgelaufen ({status}).');
    });
});

describe('isProgrammingError', () => {
    it('is true for the request-shape problems, false for the rest', () => {
        for (const slug of ['invalid-id', 'invalid-body', 'not-found', 'https-required', 'method-not-allowed', 'payload-too-large', 'unsupported-media-type']) {
            expect(isProgrammingError(new BackendProblem(slug, 400)), slug).toBe(true);
        }
        for (const slug of ['forbidden', 'entry-not-found', 'internal-error', 'something-new', 'password-invalid']) {
            expect(isProgrammingError(new BackendProblem(slug, 400)), slug).toBe(false);
        }
        expect(isProgrammingError(new Error('x'))).toBe(false);
    });
});
