import { describe, expect, it } from 'vitest';
import { LoginStateError, LoginUnavailable, PersonMismatch } from '../backend/auth';
import { BackendProblem, BackendUnreachable, UnexpectedResponse } from '../backend/problems';
import { CtHttpError, CtRateLimitedError } from '../ct/errors';
import type { CtCategory, Permissions } from '../ct/types';
import { LoginLoop } from './useSession';
import {
    computeAppState,
    currentNav,
    failureMessage,
    frameFor,
    loginOutcome,
    settingsEditorFrom,
    settingsReady,
    setupCapableFrom,
    routeView,
    type AppState,
    type AppStateInputs,
} from './app-state';

/** Everything fine for an admin: row 10. */
const base = (): AppStateInputs => ({
    loading: false,
    anonymous: false,
    view: true,
    ctFailed: false,
    oldLayout: false,
    newerSchema: false,
    duplicates: [],
    settingsReady: true,
    login: 'ok',
    backendVersion: '0.1.4+abc',
    appVersion: '0.1.0',
    admin: true,
});

/** One condition per row of spec 3.2, in table order; `ct-failed` is the ChurchTools read failure after row 2. */
const rows: { name: string; apply: (i: AppStateInputs) => void; state: AppState }[] = [
    { name: '1 loading', apply: (i) => (i.loading = true), state: 'loading' },
    { name: '2 anonymous', apply: (i) => (i.anonymous = true), state: 'no-access' },
    { name: '2 view missing', apply: (i) => (i.view = false), state: 'no-access' },
    { name: '2b ChurchTools read failed', apply: (i) => (i.ctFailed = true), state: 'backend-error' },
    { name: '3 old layout', apply: (i) => (i.oldLayout = true), state: 'migration-needed' },
    { name: '4 newer schema', apply: (i) => (i.newerSchema = true), state: 'update-needed' },
    { name: '4a duplicates', apply: (i) => (i.duplicates = ['access']), state: 'backend-error' },
    { name: '5 settings not ready', apply: (i) => (i.settingsReady = false), state: 'setup-needed' },
    { name: '6 no-service-access', apply: (i) => (i.login = 'no-service-access'), state: 'no-access' },
    { name: '7 login failed', apply: (i) => (i.login = 'failed'), state: 'backend-error' },
    { name: '8 version mismatch', apply: (i) => (i.backendVersion = '0.2.0'), state: 'version-mismatch' },
    { name: '9 not admin', apply: (i) => (i.admin = false), state: 'user' },
];

describe('computeAppState (spec 3.2)', () => {
    it.each(rows)('row $name → $state', ({ apply, state }) => {
        const inputs = base();
        apply(inputs);
        expect(computeAppState(inputs)).toBe(state);
    });

    it('row 10: login answer admin: true → admin', () => {
        expect(computeAppState(base())).toBe('admin');
    });

    // Rows 6 and 7 are two values of the same input (the login outcome), so they never apply together.
    const exclusive = (a: string, b: string) => a.startsWith('6 ') && b.startsWith('7 ');
    const pairs = rows.flatMap((earlier, i) => rows.slice(i + 1).filter((later) => !exclusive(earlier.name, later.name)).map((later) => ({ earlier, later })));

    it('covers every pair of rows that can apply together', () => {
        expect(pairs).toHaveLength((rows.length * (rows.length - 1)) / 2 - 1);
    });
    it.each(pairs.map((p) => [p.earlier.name, p.later.name, p] as const))('%s beats %s', (_a, _b, { earlier, later }) => {
        const inputs = base();
        later.apply(inputs);
        earlier.apply(inputs);
        expect(computeAppState(inputs)).toBe(earlier.state);
        // The order of applying doesn't matter, only the table order.
        const reversed = base();
        earlier.apply(reversed);
        later.apply(reversed);
        expect(computeAppState(reversed)).toBe(earlier.state);
    });

    it('rights that could not be read: a ChurchTools failure is backend-error, never no-access', () => {
        expect(computeAppState({ ...base(), view: null, ctFailed: true })).toBe('backend-error');
        expect(computeAppState({ ...base(), view: null, ctFailed: true, anonymous: true })).toBe('no-access');
    });

    it('rights not known without a failure never pass (fail closed)', () => {
        expect(computeAppState({ ...base(), view: null })).toBe('no-access');
    });

    it('an old layout beats a missing backendUrl (migration, not setup)', () => {
        expect(computeAppState({ ...base(), oldLayout: true, settingsReady: false })).toBe('migration-needed');
    });

    it('everything bad at once is still loading while loading', () => {
        expect(
            computeAppState({
                loading: true,
                anonymous: true,
                view: false,
                ctFailed: true,
                oldLayout: true,
                newerSchema: true,
                duplicates: ['settings', 'access'],
                settingsReady: false,
                login: 'failed',
                backendVersion: null,
                appVersion: '0.1.0',
                admin: true,
            }),
        ).toBe('loading');
    });

    it('a login without a backend version is a mismatch, never a role (fail closed)', () => {
        expect(computeAppState({ ...base(), backendVersion: null })).toBe('version-mismatch');
        expect(computeAppState({ ...base(), backendVersion: null, admin: false })).toBe('version-mismatch');
    });

    it('version mismatch ignores build metadata on both sides', () => {
        expect(computeAppState({ ...base(), appVersion: '0.1.3', backendVersion: '0.1.0+abc-dirty' })).toBe('admin');
        expect(computeAppState({ ...base(), appVersion: '0.1.0+abc-dirty', backendVersion: '0.1.7' })).toBe('admin');
        expect(computeAppState({ ...base(), appVersion: '0.2.0', backendVersion: '0.1.9' })).toBe('version-mismatch');
        expect(computeAppState({ ...base(), appVersion: '0.1.0', backendVersion: '1.1.0' })).toBe('version-mismatch');
    });

    it('a version mismatch also hides the user role', () => {
        expect(computeAppState({ ...base(), admin: false, backendVersion: '0.3.0' })).toBe('version-mismatch');
    });
});

describe('loginOutcome', () => {
    it('no error is ok', () => {
        expect(loginOutcome(null)).toBe('ok');
    });
    it('no-service-access is its own outcome (row 6)', () => {
        expect(loginOutcome(new BackendProblem('no-service-access', 403))).toBe('no-service-access');
    });
    it.each([
        ['forbidden', new BackendProblem('forbidden', 403)],
        ['oauth-code-invalid', new BackendProblem('oauth-code-invalid', 400)],
        ['unreachable', new BackendUnreachable()],
        ['unexpected', new UnexpectedResponse(500)],
        ['login loop', new LoginLoop()],
        ['any error', new Error('x')],
        ['a non-error value', 'oops'],
    ])('%s is a failed login (row 7)', (_name, error) => {
        expect(loginOutcome(error)).toBe('failed');
    });
});

describe('settingsReady (row 5)', () => {
    const value = { schema: 2 as const, revision: 1, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16 };
    const ok = (extra: Record<string, unknown>) => ({ state: 'ok' as const, value: { ...value, ...extra }, valueId: 1 });

    it('needs backendUrl and oauthClientId', () => {
        expect(settingsReady(ok({ backendUrl: 'https://b.example', oauthClientId: 'abc' }))).toBe(true);
        expect(settingsReady(ok({ oauthClientId: 'abc' }))).toBe(false);
        expect(settingsReady(ok({ backendUrl: 'https://b.example' }))).toBe(false);
        expect(settingsReady(ok({}))).toBe(false);
        expect(settingsReady(ok({ backendUrl: '', oauthClientId: 'abc' }))).toBe(false);
        expect(settingsReady(ok({ backendUrl: 'https://b.example', oauthClientId: '' }))).toBe(false);
    });
    it('is false for missing, invalid and newer settings', () => {
        expect(settingsReady({ state: 'missing' })).toBe(false);
        expect(settingsReady({ state: 'invalid', issues: ['x'] })).toBe(false);
        expect(settingsReady({ state: 'newer', schema: 3 })).toBe(false);
    });
});

const perms = (p: Partial<Permissions> = {}): Permissions => ({
    view: true,
    'create custom category': false,
    'view custom category': [],
    'edit custom category': [],
    'delete custom category': [],
    'view custom data': [],
    'create custom data': [],
    'edit custom data': [],
    'delete custom data': [],
    ...p,
});
const categories: CtCategory[] = [
    { id: 11, name: 'settings', shorty: 'settings' },
    { id: 12, name: 'access', shorty: 'access' },
    { id: 13, name: 'passwordStore', shorty: 'pwstore' },
];

describe('settingsEditorFrom (spec 3.1 row 3)', () => {
    it('reads edit custom data on the settings and access categories by id', () => {
        expect(settingsEditorFrom(perms({ 'edit custom data': [11] }), categories)).toEqual({ settings: true, access: false });
        expect(settingsEditorFrom(perms({ 'edit custom data': [12] }), categories)).toEqual({ settings: false, access: true });
        expect(settingsEditorFrom(perms({ 'edit custom data': [11, 12] }), categories)).toEqual({ settings: true, access: true });
    });
    it('other rights or categories do not count', () => {
        expect(settingsEditorFrom(perms({ 'edit custom data': [13] }), categories)).toEqual({ settings: false, access: false });
        expect(
            settingsEditorFrom(
                perms({ 'view custom data': [11, 12], 'create custom data': [11, 12], 'delete custom data': [11, 12], 'edit custom category': [11, 12] }),
                categories,
            ),
        ).toEqual({ settings: false, access: false });
    });
    it('matches the category by name, not by shorty, and nothing without the categories', () => {
        const odd = [{ id: 21, name: 'other', shorty: 'settings' }];
        expect(settingsEditorFrom(perms({ 'edit custom data': [21] }), odd)).toEqual({ settings: false, access: false });
        expect(settingsEditorFrom(perms({ 'edit custom data': [11, 12] }), [])).toEqual({ settings: false, access: false });
    });
});

describe('setupCapableFrom (provisional, spec 5.2)', () => {
    it('is exactly create custom category === true', () => {
        expect(setupCapableFrom(perms({ 'create custom category': true }))).toBe(true);
        expect(setupCapableFrom(perms())).toBe(false);
        expect(setupCapableFrom(perms({ 'create custom category': 'true' as unknown as boolean }))).toBe(false);
        expect(setupCapableFrom(perms({ 'create custom category': 1 as unknown as boolean }))).toBe(false);
    });
});

const none = { settings: false, access: false };
const editor = { settings: true, access: false };
const accessEditor = { settings: false, access: true };

describe('frameFor (E3, spec 3.1)', () => {
    it('admins get the sidebar with the four entries', () => {
        expect(frameFor('admin', none)).toEqual({ mode: 'sidebar', nav: ['/', '/manage', '/settings', '/about'] });
        expect(frameFor('admin', editor)).toEqual({ mode: 'sidebar', nav: ['/', '/manage', '/settings', '/about'] });
    });
    it('normal users get the card without navigation', () => {
        expect(frameFor('user', none)).toEqual({ mode: 'card', nav: [] });
    });
    it('users who are settings editors also get „Einstellungen“', () => {
        expect(frameFor('user', editor)).toEqual({ mode: 'sidebar', nav: ['/', '/settings', '/about'] });
        expect(frameFor('user', accessEditor)).toEqual({ mode: 'sidebar', nav: ['/', '/settings', '/about'] });
    });
    it('settings editors keep „Einstellungen“ when the backend login fails (3.1.2)', () => {
        expect(frameFor('backend-error', editor)).toEqual({ mode: 'sidebar', nav: ['/', '/settings'] });
        expect(frameFor('backend-error', accessEditor)).toEqual({ mode: 'sidebar', nav: ['/', '/settings'] });
        expect(frameFor('backend-error', none)).toEqual({ mode: 'card', nav: [] });
    });
    it.each(['loading', 'no-access', 'migration-needed', 'update-needed', 'setup-needed', 'version-mismatch'] as const)(
        '%s is a card without navigation, also for settings editors',
        (state) => {
            expect(frameFor(state, { settings: true, access: true })).toEqual({ mode: 'card', nav: [] });
        },
    );
});

describe('routeView: no page content before the state and the role allow it', () => {
    it('user and admin see routes without a requirement (each view checks its rights)', () => {
        for (const state of ['user', 'admin'] as const) {
            for (const path of ['/', '/about', '/nope']) expect(routeView(state, none, path)).toBe('page');
        }
    });
    it('`admin` routes are pages only in the admin state; settings editors are no admins', () => {
        expect(routeView('admin', none, '/manage', 'admin')).toBe('page');
        for (const e of [none, editor, accessEditor]) {
            expect(routeView('user', e, '/manage', 'admin')).toBe('missing-rights');
            expect(routeView('backend-error', e, '/settings/backup', 'admin')).toBe(e === none ? 'state' : 'missing-rights');
        }
    });
    it('`editor` routes are pages for admins and settings editors of either category', () => {
        expect(routeView('admin', none, '/settings/rules', 'editor')).toBe('page');
        expect(routeView('user', editor, '/settings/rules', 'editor')).toBe('page');
        expect(routeView('user', accessEditor, '/settings/rules', 'editor')).toBe('page');
        expect(routeView('user', none, '/settings/rules', 'editor')).toBe('missing-rights');
    });
    it('in backend-error only settings editors see the settings routes', () => {
        for (const path of ['/settings', '/settings/backend', '/settings/access/clients/new']) {
            expect(routeView('backend-error', editor, path, 'editor')).toBe('page');
            expect(routeView('backend-error', accessEditor, path, 'editor')).toBe('page');
            expect(routeView('backend-error', none, path, 'editor')).toBe('state');
        }
        for (const path of ['/', '/manage', '/about', '/settingsx', '/x/settings']) expect(routeView('backend-error', editor, path)).toBe('state');
    });
    it.each(['loading', 'no-access', 'migration-needed', 'update-needed', 'setup-needed', 'version-mismatch'] as const)('%s shows no route', (state) => {
        for (const path of ['/', '/settings', '/settings/backend', '/about']) {
            for (const requires of [undefined, 'admin', 'editor'] as const) expect(routeView(state, { settings: true, access: true }, path, requires)).toBe('state');
        }
    });
});

describe('currentNav', () => {
    const nav = ['/', '/manage', '/settings', '/about'] as const;
    it('is the entry of the route or of its parent', () => {
        expect(currentNav('/', nav)).toBe('/');
        expect(currentNav('/manage', nav)).toBe('/manage');
        expect(currentNav('/manage/5', nav)).toBe('/manage');
        expect(currentNav('/settings/access/clients/new', nav)).toBe('/settings');
        expect(currentNav('/about', nav)).toBe('/about');
    });
    it('needs a whole path segment', () => {
        expect(currentNav('/managed', nav)).toBe('/managed');
        expect(currentNav('/settingsx', nav)).toBe('/settingsx');
        expect(currentNav('/nope', nav)).toBe('/nope');
    });
    it('is the path itself when no entry matches', () => {
        expect(currentNav('/nope', ['/settings'])).toBe('/nope');
        expect(currentNav('/', ['/settings'])).toBe('/');
    });
});

describe('failureMessage (spec 3.2 row 7, 8.2, 8.3)', () => {
    const detailed = (error: unknown) => failureMessage({ kind: 'login', error }, true);
    const plain = (error: unknown) => failureMessage({ kind: 'login', error }, false);

    it('users see only that the service is unreachable, with a login action', () => {
        for (const error of [new BackendUnreachable(), new BackendProblem('misconfigured', 500), new UnexpectedResponse(502), new Error('x')]) {
            expect(plain(error)).toEqual({ key: 'state.unavailable', params: {}, loginAction: true });
        }
    });

    it('settings editors see the problem text with its status and the plain detail', () => {
        const p = new BackendProblem('misconfigured', 500);
        p.detail = 'BACKEND_KEY is missing';
        expect(detailed(p)).toEqual({ key: 'problems.notSetUp', params: { status: 500 }, loginAction: true, detail: 'BACKEND_KEY is missing' });
        expect(detailed(new BackendUnreachable())).toEqual({ key: 'problems.unreachable', params: {}, loginAction: true });
        expect(detailed(new UnexpectedResponse(502))).toEqual({ key: 'problems.unexpected', params: { status: 502 }, loginAction: true });
        expect(detailed(new BackendProblem('internal-error', 500))).toEqual({ key: 'problems.generic', params: { status: 500 }, loginAction: true });
    });

    it('rate limits show minutes, rounded up and clamped to 1..60', () => {
        const limited = (s: number) => Object.assign(new BackendProblem('upstream-rate-limited', 429), { retryAfter: s });
        expect(detailed(limited(61)).params).toEqual({ status: 429, n: 2 });
        expect(detailed(limited(0)).params).toEqual({ status: 429, n: 1 });
        expect(detailed(limited(1e9)).params).toEqual({ status: 429, n: 60 });
        expect(detailed(new BackendProblem('too-many-attempts', 429)).params).toEqual({ status: 429, n: 1 });
    });

    it('a broken login says so to everyone, with the login action (8.2)', () => {
        const loginErrors = [new LoginLoop(), new LoginStateError(), new PersonMismatch(), new LoginUnavailable(), new BackendProblem('oauth-code-invalid', 400)];
        for (const error of loginErrors) {
            expect(plain(error)).toEqual({ key: 'problems.loginFailed', params: {}, loginAction: true });
            expect(detailed(error)).toEqual({ key: 'problems.loginFailed', params: {}, loginAction: true });
        }
    });

    it('a ChurchTools failure names ChurchTools, with minutes for a rate limit (8.3)', () => {
        const ct = (error: unknown, d: boolean) => failureMessage({ kind: 'churchtools', error }, d);
        expect(ct(new CtHttpError(500), false)).toEqual({ key: 'state.ctUnavailable', params: {}, loginAction: false });
        expect(ct(new Error('network'), true)).toEqual({ key: 'state.ctUnavailable', params: {}, loginAction: false });
        expect(ct(new CtRateLimitedError(60_000), false)).toEqual({ key: 'state.ctRateLimited', params: { n: 1 }, loginAction: false });
        expect(ct(new CtRateLimitedError(150_000), true)).toEqual({ key: 'state.ctRateLimited', params: { n: 3 }, loginAction: false });
        expect(ct(new CtRateLimitedError(1e10), true).params).toEqual({ n: 60 });
    });

    it('duplicates (row 4a, E1): editors are told to choose a value, users only that the service is unreachable; no login helps', () => {
        expect(failureMessage({ kind: 'duplicates', categories: ['settings', 'access'] }, true)).toEqual({ key: 'state.duplicates', params: { categories: 'settings, access' }, loginAction: false });
        expect(failureMessage({ kind: 'duplicates', categories: ['access'] }, false)).toEqual({ key: 'state.unavailable', params: {}, loginAction: false });
    });

    it('never puts a detail into the message for users', () => {
        const p = new BackendProblem('misconfigured', 500);
        p.detail = 'secret detail';
        expect(plain(p)).not.toHaveProperty('detail');
    });
});
