/**
 * App layer (mounted): startup order, every app state as the person sees it, the frame by role, routes and the dialog
 * container. Real `Auth`, real `ExtensionStore` over the fake ChurchTools, fake backend; only the browser is faked.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, type Router } from 'vue-router';
import App from './App.vue';
import { SERVICES_KEY, type Services } from './app/services';
import { createAppState } from './app/useAppState';
import { createSession } from './app/useSession';
import type { BackendApi } from './backend/api';
import { Auth, CALLBACK_WINDOW_KEY, LAST_LOGIN_KEY, LOGIN_KEY, LOGIN_RETRY_KEY, POPUP_MESSAGE, TOKEN_KEY, type AuthEnv, type CallbackWindow } from './backend/auth';
import { backendBase } from './backend/http';
import { BackendProblem, BackendUnreachable } from './backend/problems';
import type { CtApi } from './ct/api';
import { CtRateLimitedError } from './ct/errors';
import type { Permissions } from './ct/types';
import { createFakeBackend, type FakeBackendOptions } from './dev/fake-backend';
import { createFakeChurchTools } from './dev/fake-churchtools';
import { createAppI18n } from './i18n';
import { createAppRouter } from './router';
import { ChurchToolsKv } from './store/churchtools-kv';
import { ExtensionStore } from './store/repository';
import { answerConfirm, useConfirm } from './ui/useConfirm';

const ORIGIN = 'https://ct.example';
const BACKEND = 'https://pw.example';
const CLIENT = 'oauth-client-1';
const NOW = 1_800_000_000_000;
const ME = 1;
const SETTINGS_ID = 11;
const ACCESS_ID = 12;

const SETTINGS = { schema: 2, revision: 1, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16, backendUrl: BACKEND, oauthClientId: CLIENT };
const ACCESS = { schema: 2, revision: 1, groups: { users: { groupId: 1, createdBySetup: true }, admins: { groupId: 2, createdBySetup: true }, service: { groupId: 3, createdBySetup: true } }, machineClients: [] };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (sub: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: String(sub) })}.c2ln`;

class MemoryStorage {
    map = new Map<string, string>();
    getItem(k: string) {
        return this.map.has(k) ? this.map.get(k)! : null;
    }
    setItem(k: string, v: string) {
        this.map.set(k, String(v));
    }
    removeItem(k: string) {
        this.map.delete(k);
    }
}

interface Options {
    path?: string;
    /** `null`: nobody logged in to ChurchTools. */
    person?: number | null;
    perms?: Partial<Permissions>;
    /** Raw stored value of `settings`; `null` = none stored. */
    settings?: unknown;
    access?: unknown;
    setupCompletedCategory?: boolean;
    /** A usable stored token (role and version from the login answer); `null` = none. */
    token?: { admin: boolean; version?: string; person?: number } | null;
    appVersion?: string;
    backend?: FakeBackendOptions;
    /** Replaces the backend's login (e.g. unreachable). */
    login?: BackendApi['login'];
    opener?: CallbackWindow['opener'];
    /** Replaces ChurchTools for the app and the store; `router` is the app's router. */
    ct?: (ct: CtApi, router: Router) => CtApi;
    /** Replaces ChurchTools only where the app asks it directly (whoami, rights, module, categories), not in the store. */
    appCt?: (ct: CtApi) => CtApi;
    /** Extra sessionStorage entries before startup. */
    storage?: Record<string, string>;
    /** sessionStorage can't be used (private mode, blocked). */
    noStorage?: boolean;
    /** Put a session into the services, so the test can drive it. */
    session?: boolean;
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    answerConfirm({ confirmed: false });
    document.body.innerHTML = '';
});

const userPerms = (p: Partial<Permissions> = {}): Permissions => ({
    view: true,
    'create custom category': false,
    'view custom category': [SETTINGS_ID, ACCESS_ID],
    'edit custom category': [],
    'delete custom category': [],
    'view custom data': [SETTINGS_ID],
    'create custom data': [],
    'edit custom data': [],
    'delete custom data': [],
    ...p,
});
const EDITOR: Partial<Permissions> = { 'view custom data': [SETTINGS_ID, ACCESS_ID], 'edit custom data': [SETTINGS_ID, ACCESS_ID] };

/** Everything the app gets from outside; `start` mounts it. */
async function build(o: Options = {}) {
    const raw = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
    const values = [];
    const settings = o.settings === undefined ? SETTINGS : o.settings;
    const access = o.access === undefined ? ACCESS : o.access;
    if (settings !== null) values.push({ id: 101, dataCategoryId: SETTINGS_ID, value: raw(settings) });
    if (access !== null) values.push({ id: 102, dataCategoryId: ACCESS_ID, value: raw(access) });
    const categories = [
        { id: SETTINGS_ID, name: 'settings', shorty: 'settings' },
        { id: ACCESS_ID, name: 'access', shorty: 'access' },
    ];
    if (o.setupCompletedCategory) categories.push({ id: 14, name: 'setupCompleted', shorty: 'setupcompleted' });
    const perms = userPerms(o.perms);
    if (o.setupCompletedCategory) perms['view custom category'] = [...perms['view custom category'], 14];
    const fakeCt = createFakeChurchTools({
        moduleKey: 'ctpassstore',
        moduleId: 7,
        currentPersonId: o.person === undefined ? ME : o.person,
        persons: [{ id: ME, firstName: 'Anna', lastName: 'Admin' }],
        groups: [],
        categories,
        values,
        permissions: perms,
    });
    const router: Router = createAppRouter(createMemoryHistory());
    const ct = o.ct ? o.ct(fakeCt, router) : fakeCt;

    const storage = new MemoryStorage();
    for (const [key, value] of Object.entries(o.storage ?? {})) storage.setItem(key, value);
    const assigned: string[] = [];
    const env: AuthEnv = {
        origin: ORIGIN,
        instanceBaseUrl: ORIGIN,
        redirectPath: '/ccm/ctpassstore/auth/callback',
        storage: () => (o.noStorage ? null : storage),
        assign: (url) => void assigned.push(url),
        open: () => null,
        listen: () => () => undefined,
        every: () => () => undefined,
        now: () => NOW,
    };
    const token = o.token === undefined ? { admin: false } : o.token;
    if (token) {
        const person = token.person ?? ME;
        storage.setItem(
            TOKEN_KEY,
            JSON.stringify({ accessToken: jwt(person), expiresAt: NOW + 600_000, admin: token.admin, version: token.version ?? '0.1.0', backend: backendBase(BACKEND), person }),
        );
    }
    const fakeBackend = createFakeBackend({ personId: ME, ctOrigin: ORIGIN, validCodes: ['good-code'], version: '0.1.2+abc', ...o.backend });
    const backendApi: BackendApi = o.login ? { ...fakeBackend, login: o.login } : fakeBackend;
    const auth = new Auth(() => backendApi, env);
    const calls: string[] = [];
    for (const name of ['configure', 'bindPerson', 'startPageLogin', 'completePageLogin', 'recentPageLogin'] as const) {
        const original = auth[name].bind(auth) as (...args: unknown[]) => unknown;
        vi.spyOn(auth, name).mockImplementation(((...args: unknown[]) => {
            calls.push(name);
            return original(...args);
        }) as never);
    }
    const session = o.session ? createSession(auth, () => router.currentRoute.value.fullPath) : null;
    const services: Services = {
        ...(session ? { session } : {}),
        ct: o.appCt ? o.appCt(ct) : ct,
        store: new ExtensionStore(new ChurchToolsKv(ct, 'ctpassstore')),
        auth,
        backend: () => backendApi,
        language: 'de',
        appVersion: o.appVersion ?? '0.1.0',
    };
    const win: CallbackWindow = { opener: o.opener ?? null, origin: ORIGIN, close: vi.fn() };
    await router.push(o.path ?? '/');
    return { router, auth, storage, assigned, calls, win, fakeCt, fakeBackend, services, session };
}

async function start(o: Options = {}) {
    const built = await build(o);
    const { router, services, win } = built;
    const provide: Record<symbol, unknown> = { [SERVICES_KEY as symbol]: services, [CALLBACK_WINDOW_KEY as symbol]: win };
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router, createAppI18n('de')], provide } });
    mounted.push(wrapper);
    await settle();
    return { ...built, wrapper };
}

/** The login data a page login leaves in sessionStorage before ChurchTools sends the person back. */
const seedLogin = (returnPath = '/about', extra: Record<string, string> = {}) => ({
    [LOGIN_KEY]: JSON.stringify({ state: 'state-1', verifier: 'v'.repeat(43), returnPath, backendUrl: BACKEND }),
    ...extra,
});

/** Startup awaits real Web Crypto (PKCE) as well as promises, so a few macrotasks are needed. */
async function settle() {
    for (let i = 0; i < 10; i++) {
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    }
}

const TEXT = {
    loading: 'Lade …',
    noAccess: 'Du hast keinen Zugriff auf diese Erweiterung. Wende dich an die Verantwortlichen in deiner Gemeinde.',
    waiting: 'Die Erweiterung wird gerade eingerichtet. Wende dich bei Fragen an die Verantwortlichen in deiner Gemeinde.',
    setupNote: 'Der neue Einrichtungsassistent kommt mit der nächsten Version der Erweiterung.',
    update: 'Bitte aktualisiere die Erweiterung.',
    unavailable: 'Der Dienst ist gerade nicht erreichbar. Versuch es später noch einmal.',
    loginFailed: 'Die Anmeldung hat nicht geklappt. Lade die Seite neu.',
    updating: 'Der Dienst wird gerade aktualisiert. Versuch es später noch einmal.',
    page: 'Diese Seite folgt mit einem späteren Schritt.',
    needsAdmin: 'Diese Seite ist nur für Admins.',
    needsEditor: 'Diese Seite ist nur für Admins und für Personen, die die Einstellungen ändern dürfen.',
    /** „Mein Passwort“ shows the title of the settings texts (default of spec 4.6). */
    passwordTitle: 'Mein Zweitpasswort',
};

const navLinks = (w: VueWrapper) => w.findAll('nav a').map((a) => [a.text(), a.attributes('href')]);
const showsPage = (w: VueWrapper) => w.text().includes(TEXT.page);
/** „Mein Passwort“ (Task 12) is a real page now, no placeholder. */
const showsPasswordPage = (w: VueWrapper) => w.find('h1').exists() && w.find('h1').text() === TEXT.passwordTitle;

describe('frame by role (E3)', () => {
    it('a normal user gets the card without navigation and a footer link to /about', async () => {
        const { wrapper } = await start({ token: { admin: false } });
        expect(wrapper.find('.cps-frame--card').exists()).toBe(true);
        expect(wrapper.find('nav').exists()).toBe(false);
        expect(wrapper.find('select').exists()).toBe(false);
        expect(wrapper.find('h1').text()).toBe(TEXT.passwordTitle);
        const footer = wrapper.find('footer a');
        expect(footer.text()).toBe('Über');
        expect(footer.attributes('href')).toBe('/about');
    });

    it('the footer of „Über“ leads back to „Mein Passwort“', async () => {
        const { wrapper } = await start({ token: { admin: false }, path: '/about' });
        expect(wrapper.find('h1').text()).toBe('Über');
        expect(wrapper.find('footer a').attributes('href')).toBe('/');
    });

    it('an admin gets the sidebar with the four entries and no footer', async () => {
        const { wrapper } = await start({ token: { admin: true } });
        expect(wrapper.find('.cps-frame--sidebar').exists()).toBe(true);
        expect(navLinks(wrapper)).toEqual([
            ['Mein Passwort', '/'],
            ['Passwörter verwalten', '/manage'],
            ['Einstellungen', '/settings'],
            ['Über', '/about'],
        ]);
        expect(wrapper.find('nav a[aria-current="page"]').text()).toBe('Mein Passwort');
        expect(wrapper.find('footer').exists()).toBe(false);
    });

    it('marks the parent entry on a nested route and routes on the dropdown', async () => {
        const { wrapper, router } = await start({ token: { admin: true }, path: '/manage/5' });
        expect(wrapper.find('nav a[aria-current="page"]').text()).toBe('Passwörter verwalten');
        expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('/manage');
        await wrapper.find('select').setValue('/settings');
        await settle();
        expect(router.currentRoute.value.path).toBe('/settings');
        expect(wrapper.find('nav a[aria-current="page"]').text()).toBe('Einstellungen');
    });

    it('a user who is a settings editor also gets „Einstellungen“', async () => {
        const { wrapper } = await start({ token: { admin: false }, perms: EDITOR });
        expect(navLinks(wrapper)).toEqual([
            ['Mein Passwort', '/'],
            ['Einstellungen', '/settings'],
            ['Über', '/about'],
        ]);
    });

    it('the role follows the login answer, not ChurchTools rights alone', async () => {
        const { wrapper } = await start({ token: { admin: false }, perms: { ...EDITOR, 'create custom category': true } });
        expect(navLinks(wrapper).map(([, to]) => to)).not.toContain('/manage');
    });
});

describe('routes (spec 4.1)', () => {
    it('an unknown path shows „Seite nicht gefunden“ with a link to /', async () => {
        const { wrapper } = await start({ path: '/does/not/exist' });
        expect(wrapper.find('h1').text()).toBe('Seite nicht gefunden');
        expect(wrapper.find('main a[href="/"]').exists()).toBe(true);
    });

    it.each([
        ['/', 'Mein Zweitpasswort'],
        ['/manage', 'Passwörter verwalten'],
        ['/manage/5', 'Passwörter verwalten'],
        ['/settings', 'Einstellungen'],
        ['/settings/rules', 'Passwortregeln'],
        ['/settings/texts', 'Texte'],
        ['/settings/access', 'Zugriff'],
        ['/settings/access/clients/new', 'Maschinen-Client'],
        ['/settings/access/clients/wlan', 'Maschinen-Client'],
        ['/settings/backend', 'Backend & Status'],
        ['/settings/backup', 'Sicherung'],
        ['/settings/setup', 'Einrichtung'],
        ['/about', 'Über'],
    ])('%s is a page (%s)', async (path, title) => {
        const { wrapper } = await start({ token: { admin: true }, path });
        expect(wrapper.find('h1').text()).toBe(title);
    });

    it.each(['/manage', '/manage/5', '/settings', '/settings/rules', '/settings/texts', '/settings/access', '/settings/access/clients/new', '/settings/access/clients/x', '/settings/backend', '/settings/backup', '/settings/setup'])(
        'a plain user on %s gets the missing-rights banner, not the page',
        async (path) => {
            const { wrapper } = await start({ token: { admin: false }, path });
            expect(showsPage(wrapper)).toBe(false);
            const banner = wrapper.find('main .cps-banner--warning');
            expect(banner.exists()).toBe(true);
            expect(banner.text()).toMatch(/^Diese Seite ist nur für Admins/);
            expect(wrapper.find('main a[href="/"]').exists()).toBe(true);
            // The card's footer keeps its link to „Über“ next to the banner (spec 4.1).
            expect(wrapper.find('footer a[href="/about"]').exists()).toBe(true);
        },
    );

    it.each([
        ['/manage', TEXT.needsAdmin],
        ['/settings/backup', TEXT.needsAdmin],
        ['/settings/setup', TEXT.needsAdmin],
        ['/settings', TEXT.needsEditor],
    ])('the banner on %s names the missing right', async (path, text) => {
        const { wrapper } = await start({ token: { admin: false }, path });
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(text);
    });

    it.each(['/settings', '/settings/rules', '/settings/texts', '/settings/access', '/settings/access/clients/x', '/settings/backend'])(
        'a settings editor who is no admin gets the page %s',
        async (path) => {
            const { wrapper } = await start({ token: { admin: false }, perms: EDITOR, path });
            expect(showsPage(wrapper)).toBe(true);
        },
    );

    it.each(['/manage', '/manage/5', '/settings/backup', '/settings/setup'])('a settings editor who is no admin does not get %s', async (path) => {
        const { wrapper } = await start({ token: { admin: false }, perms: EDITOR, path });
        expect(showsPage(wrapper)).toBe(false);
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(TEXT.needsAdmin);
    });

    it('everyone with access gets /', async () => {
        const { wrapper } = await start({ token: { admin: false }, path: '/' });
        expect(showsPasswordPage(wrapper)).toBe(true);
    });

    it('everyone with access gets /about', async () => {
        const { wrapper } = await start({ token: { admin: false }, path: '/about' });
        expect(showsPage(wrapper)).toBe(true);
    });

    it('the callback route reached inside the running app goes to /', async () => {
        const { router, wrapper } = await start({ token: { admin: true } });
        await router.push('/auth/callback');
        await settle();
        expect(router.currentRoute.value.path).toBe('/');
        expect(wrapper.find('h1').text()).toBe(TEXT.passwordTitle);
    });
});

describe('startup order (spec 7.1, carries of Task 9)', () => {
    it('configures Auth with the settings and binds whoami before deciding on a page login', async () => {
        const { calls, assigned, storage, wrapper } = await start({ token: null, path: '/settings/rules?x=1' });
        expect(calls.indexOf('configure')).toBeGreaterThanOrEqual(0);
        expect(calls.indexOf('configure')).toBeLessThan(calls.indexOf('bindPerson'));
        expect(calls.indexOf('bindPerson')).toBeLessThan(calls.indexOf('startPageLogin'));
        expect(assigned).toHaveLength(1);
        const url = new URL(assigned[0]!);
        expect(url.origin + url.pathname).toBe(`${ORIGIN}/oauth/authorize`);
        expect(url.searchParams.get('client_id')).toBe(CLIENT);
        expect(JSON.parse(storage.getItem(LOGIN_KEY)!)).toMatchObject({ returnPath: '/settings/rules?x=1', backendUrl: BACKEND });
        // The page leaves: only the loading line, no page, no navigation.
        expect(wrapper.find('main').text()).toBe(TEXT.loading);
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('passes the settings and whoami to Auth', async () => {
        const { auth } = await start({ token: { admin: false } });
        expect(auth.configure).toHaveBeenCalledWith({ backendUrl: BACKEND, clientId: CLIENT });
        expect(auth.bindPerson).toHaveBeenCalledWith(ME);
    });

    it('a stored token of another person is not used: a page login starts', async () => {
        const { assigned, wrapper } = await start({ token: { admin: true, person: 2 } });
        expect(assigned).toHaveLength(1);
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('a page login that just completed without a usable token is backend-error, without a redirect (loop guard)', async () => {
        const { assigned, wrapper, auth } = await startWithStorage({ [LAST_LOGIN_KEY]: String(NOW - 1000) });
        expect(assigned).toEqual([]);
        expect(auth.startPageLogin).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain(TEXT.loginFailed);
        // „Erneut anmelden“ is the person's own choice and passes the guard.
        await wrapper.find('button').trigger('click');
        await settle();
        expect(assigned).toHaveLength(1);
    });

    it('a page login long enough ago does not block a new one', async () => {
        const { assigned } = await startWithStorage({ [LAST_LOGIN_KEY]: String(NOW - 60_000) });
        expect(assigned).toHaveLength(1);
    });

    it('never asks Auth before ChurchTools and the settings are known', async () => {
        const { calls } = await start({ token: null, settings: null });
        expect(calls).toEqual([]);
    });

    it('a page login that cannot start (no sessionStorage) is backend-error with the login text, no redirect', async () => {
        const { wrapper, assigned, calls } = await start({ token: null, noStorage: true });
        expect(calls).toContain('startPageLogin');
        expect(assigned).toEqual([]);
        expect(wrapper.text()).toContain(TEXT.loginFailed);
        expect(wrapper.text()).not.toContain(TEXT.updating);
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('„Erneut anmelden“ comes back to the full path the person was on', async () => {
        const { wrapper, assigned, storage } = await startWithStorage({ [LAST_LOGIN_KEY]: String(NOW - 1000) }, { path: '/about?tab=x#top' });
        expect(assigned).toEqual([]);
        await wrapper.find('button').trigger('click');
        await settle();
        expect(assigned).toHaveLength(1);
        expect(JSON.parse(storage.getItem(LOGIN_KEY)!)).toMatchObject({ returnPath: '/about?tab=x#top' });
    });

    it('start() runs once however often it is called', async () => {
        const whoami = vi.fn();
        const built = await build({ ct: (ct) => ({ ...ct, whoami: (...a) => (whoami(), ct.whoami(...a)) }) });
        const app = createAppState({
            services: built.services,
            router: built.router,
            session: createSession(built.auth, () => built.router.currentRoute.value.fullPath),
            callbackWindow: built.win,
            appVersion: '0.1.0',
        });
        const first = app.start();
        expect(app.start()).toBe(first);
        await first;
        await app.start();
        await settle();
        expect(whoami).toHaveBeenCalledOnce();
        expect(built.calls.filter((c) => c === 'configure')).toHaveLength(1);
        expect(app.state.value).toBe('user');
    });

    it('lists the settings values once at startup', async () => {
        const listed: number[] = [];
        await start({ ct: (ct) => ({ ...ct, values: (m, c) => (listed.push(c), ct.values(m, c)) }) });
        expect(listed.filter((c) => c === SETTINGS_ID)).toHaveLength(1);
    });
});

/** `start` without a token but with extra sessionStorage entries. */
function startWithStorage(entries: Record<string, string>, o: Options = {}) {
    return start({ token: null, ...o, storage: entries });
}

describe('/auth/callback (spec 7.1, 8.2)', () => {
    it('as a page: binds the person before completing, ends on the remembered path as user', async () => {
        const seededLogin = seedLogin();
        const { wrapper, router, calls, assigned } = await startWithStorage(seededLogin, { path: '/auth/callback?code=good-code&state=state-1' });
        expect(calls.indexOf('bindPerson')).toBeLessThan(calls.indexOf('completePageLogin'));
        expect(calls.indexOf('configure')).toBeLessThan(calls.indexOf('completePageLogin'));
        expect(router.currentRoute.value.fullPath).toBe('/about');
        expect(wrapper.find('h1').text()).toBe('Über');
        expect(assigned).toEqual([]);
    });

    it('a login answer for another person is refused: backend-error, the code leaves the address', async () => {
        const seededLogin = seedLogin();
        const { wrapper, router, storage } = await startWithStorage(seededLogin, { path: '/auth/callback?code=good-code&state=state-1', backend: { personId: 2 } });
        expect(wrapper.text()).toContain(TEXT.loginFailed);
        expect(router.currentRoute.value.fullPath).toBe('/');
        expect(storage.getItem(TOKEN_KEY)).toBeNull();
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('a wrong state is backend-error with the login text, and the code leaves the address', async () => {
        const seededLogin = seedLogin();
        const { wrapper, router } = await startWithStorage(seededLogin, { path: '/auth/callback?code=secret-code&state=other' });
        expect(wrapper.text()).toContain(TEXT.loginFailed);
        expect(router.currentRoute.value.fullPath).toBe('/');
        expect(wrapper.html()).not.toContain('secret-code');
    });

    it('oauth-code-invalid retries the login once', async () => {
        const seededLogin = seedLogin();
        const { wrapper, assigned, storage, router } = await startWithStorage(seededLogin, { path: '/auth/callback?code=used-code&state=state-1' });
        expect(assigned).toHaveLength(1);
        expect(storage.getItem(LOGIN_RETRY_KEY)).toBe(String(NOW));
        expect(router.currentRoute.value.fullPath).toBe('/');
        expect(wrapper.find('main').text()).toBe(TEXT.loading);
    });

    it('a second oauth-code-invalid within 60 s shows the login text instead of looping', async () => {
        const seeded = seedLogin('/about', { [LOGIN_RETRY_KEY]: String(NOW - 5000) });
        const { wrapper, assigned, router } = await startWithStorage(seeded, { path: '/auth/callback?code=used-code&state=state-1' });
        expect(assigned).toEqual([]);
        expect(wrapper.text()).toContain(TEXT.loginFailed);
        expect(router.currentRoute.value.fullPath).toBe('/');
    });

    it('no-service-access at the login is no-access (row 6)', async () => {
        const seededLogin = seedLogin('/');
        const { wrapper } = await startWithStorage(seededLogin, { path: '/auth/callback?code=good-code&state=state-1', backend: { noServiceAccess: true } });
        expect(wrapper.find('main').text()).toBe(TEXT.noAccess);
    });

    it('an unreachable backend at the login: users see the short text (row 7)', async () => {
        const seededLogin = seedLogin('/');
        const { wrapper } = await startWithStorage(seededLogin, {
            path: '/auth/callback?code=good-code&state=state-1',
            login: async () => {
                throw new BackendUnreachable();
            },
        });
        expect(wrapper.text()).toContain(TEXT.unavailable);
        expect(wrapper.find('a[href="/settings/backend"]').exists()).toBe(false);
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('settings editors see the problem, its detail as plain text and a link to „Backend & Status“ (row 7, 3.1.2)', async () => {
        const seededLogin = seedLogin('/');
        const problem = new BackendProblem('misconfigured', 500);
        problem.detail = '<b>BACKEND_KEY</b> missing';
        const { wrapper, router } = await startWithStorage(seededLogin, {
            path: '/auth/callback?code=good-code&state=state-1',
            perms: EDITOR,
            login: async () => {
                throw problem;
            },
        });
        expect(wrapper.text()).toContain('Der Dienst ist noch nicht richtig eingerichtet.');
        expect(wrapper.text()).not.toContain(TEXT.unavailable);
        expect(wrapper.find('details').text()).toContain('<b>BACKEND_KEY</b> missing');
        expect(wrapper.find('details b').exists()).toBe(false);
        const link = wrapper.find('main a[href="/settings/backend"]');
        expect(link.exists()).toBe(true);
        expect(navLinks(wrapper)).toEqual([
            ['Mein Passwort', '/'],
            ['Einstellungen', '/settings'],
        ]);
        await link.trigger('click');
        await settle();
        expect(router.currentRoute.value.path).toBe('/settings/backend');
        expect(wrapper.find('h1').text()).toBe('Backend & Status');
    });

    const unreachable = async () => {
        throw new BackendUnreachable();
    };
    const rejectCategories = (ct: CtApi): CtApi => ({ ...ct, categories: () => Promise.reject(new Error('network')) });

    it.each([
        ['the module is not found', (ct: CtApi): CtApi => ({ ...ct, moduleId: async () => null })],
        ['the categories cannot be read', rejectCategories],
    ])('when %s, nobody counts as settings editor: card, no link, no settings page in backend-error', async (_name, appCt) => {
        const { wrapper, router } = await startWithStorage(seedLogin('/settings/backend'), { path: '/auth/callback?code=good-code&state=state-1', login: unreachable, appCt });
        expect(wrapper.text()).toContain(TEXT.unavailable);
        expect(wrapper.find('.cps-frame--card').exists()).toBe(true);
        expect(wrapper.find('a[href="/settings/backend"]').exists()).toBe(false);
        await router.push('/settings/backend');
        await settle();
        expect(showsPage(wrapper)).toBe(false);
    });

    it('a settings editor whose categories cannot be read is not recognised as one', async () => {
        const { wrapper } = await startWithStorage(seedLogin('/'), { path: '/auth/callback?code=good-code&state=state-1', login: unreachable, perms: EDITOR, appCt: rejectCategories });
        expect(wrapper.text()).toContain(TEXT.unavailable);
        expect(wrapper.find('nav').exists()).toBe(false);
        expect(wrapper.find('a[href="/settings/backend"]').exists()).toBe(false);
    });

    it('in backend-error, settings editors still do not get the admin-only settings pages', async () => {
        const { wrapper, router } = await startWithStorage(seedLogin('/'), {
            path: '/auth/callback?code=good-code&state=state-1',
            perms: EDITOR,
            login: unreachable,
        });
        await router.push('/settings/backend');
        await settle();
        expect(wrapper.find('h1').text()).toBe('Backend & Status');
        await router.push('/settings/backup');
        await settle();
        expect(wrapper.find('h1').exists()).toBe(false);
        expect(showsPage(wrapper)).toBe(false);
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(TEXT.needsAdmin);
    });

    it('in backend-error, users do not get the settings pages', async () => {
        const seededLogin = seedLogin('/settings/backend');
        const { wrapper } = await startWithStorage(seededLogin, {
            path: '/auth/callback?code=good-code&state=state-1',
            login: async () => {
                throw new BackendUnreachable();
            },
        });
        expect(showsPage(wrapper)).toBe(false);
    });

    it('in a popup hands code and state to the opener and closes, reading nothing', async () => {
        const opener = { postMessage: vi.fn() };
        const state = `p.${'x'.repeat(43)}`;
        const whoami = vi.fn();
        const { win, calls, wrapper } = await start({
            path: `/auth/callback?code=c2&state=${state}`,
            opener,
            ct: (ct) => ({ ...ct, whoami: (...a) => (whoami(), ct.whoami(...a)) }),
        });
        expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith({ type: POPUP_MESSAGE, code: 'c2', state }, ORIGIN);
        expect(win.close).toHaveBeenCalledOnce();
        expect(whoami).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
        expect(wrapper.find('main').text()).toBe('Anmeldung wird abgeschlossen …');
    });

    it('a popup callback without an opener is a failed login; nothing is posted', async () => {
        const { wrapper, router, calls } = await start({ path: `/auth/callback?code=c2&state=p.${'x'.repeat(43)}`, token: null });
        expect(wrapper.text()).toContain(TEXT.loginFailed);
        expect(router.currentRoute.value.fullPath).toBe('/');
        expect(calls).not.toContain('completePageLogin');
    });

    it('a malformed popup state posts nothing and does not close', async () => {
        const opener = { postMessage: vi.fn() };
        const { win, wrapper } = await start({ path: '/auth/callback?code=c2&state=p.', opener, token: null });
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(win.close).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain(TEXT.loginFailed);
    });

    it.each(['/Auth/Callback', '/AUTH/CALLBACK/', '/auth/callback/'])('%s is the callback too (case, trailing slash)', async (path) => {
        const { router, wrapper, assigned } = await startWithStorage(seedLogin(), { path: `${path}?code=good-code&state=state-1` });
        expect(router.currentRoute.value.fullPath).toBe('/about');
        expect(wrapper.find('h1').text()).toBe('Über');
        expect(assigned).toEqual([]);
    });

    it('a popup on /auth/callback/ (trailing slash) is forwarded and closed, reading nothing', async () => {
        const opener = { postMessage: vi.fn() };
        const state = `p.${'x'.repeat(43)}`;
        const whoami = vi.fn();
        const { win, calls } = await start({
            path: `/auth/callback/?code=c2&state=${state}`,
            opener,
            ct: (ct) => ({ ...ct, whoami: (...a) => (whoami(), ct.whoami(...a)) }),
        });
        expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith({ type: POPUP_MESSAGE, code: 'c2', state }, ORIGIN);
        expect(win.close).toHaveBeenCalledOnce();
        expect(whoami).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });

    it('a declined popup login closes quietly: no message, no alert, nothing read, no page login', async () => {
        const opener = { postMessage: vi.fn() };
        const whoami = vi.fn();
        const { win, calls, wrapper, assigned } = await start({
            path: `/auth/callback?error=access_denied&state=p.${'x'.repeat(43)}`,
            opener,
            ct: (ct) => ({ ...ct, whoami: (...a) => (whoami(), ct.whoami(...a)) }),
        });
        expect(win.close).toHaveBeenCalledOnce();
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(whoami).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
        expect(assigned).toEqual([]);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('a page-login state with an opener present completes as a page login (no message, no close)', async () => {
        const opener = { postMessage: vi.fn() };
        const { win, calls, router } = await startWithStorage(seedLogin(), { path: '/auth/callback?code=good-code&state=state-1', opener });
        expect(calls).toContain('completePageLogin');
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(win.close).not.toHaveBeenCalled();
        expect(router.currentRoute.value.fullPath).toBe('/about');
    });

    it('code and state leave the address before ChurchTools is read, and the login still completes', async () => {
        let answer!: () => void;
        const asked = vi.fn();
        const { router, wrapper } = await startWithStorage(seedLogin(), {
            path: '/auth/callback?code=good-code&state=state-1',
            ct: (ct, router) => ({
                ...ct,
                whoami: (...a) => {
                    asked(router.currentRoute.value.fullPath);
                    return new Promise((resolve) => (answer = () => resolve(ct.whoami(...a))));
                },
            }),
        });
        expect(asked).toHaveBeenCalledExactlyOnceWith('/auth/callback');
        expect(router.currentRoute.value.fullPath).toBe('/auth/callback');
        expect(wrapper.find('main').text()).toBe('Anmeldung wird abgeschlossen …');
        answer();
        await settle();
        expect(router.currentRoute.value.fullPath).toBe('/about');
        expect(wrapper.find('h1').text()).toBe('Über');
    });

    it('leaves the callback address also when setup is needed', async () => {
        const { router, wrapper } = await start({ path: '/auth/callback?code=c9&state=s9', settings: null });
        expect(router.currentRoute.value.fullPath).toBe('/');
        expect(wrapper.text()).toContain(TEXT.waiting);
    });
});

describe('app states as shown (spec 3.2)', () => {
    it('row 1: only the loading line while ChurchTools answers, no page and no navigation', async () => {
        const { wrapper } = await start({ token: { admin: true }, ct: (ct) => ({ ...ct, whoami: () => new Promise(() => undefined) }) });
        expect(wrapper.find('main').text()).toBe(TEXT.loading);
        expect(wrapper.find('main [role="status"]').exists()).toBe(true);
        expect(wrapper.find('nav').exists()).toBe(false);
        expect(showsPasswordPage(wrapper)).toBe(false);
    });

    it('row 1: no page while the settings are being read', async () => {
        const { wrapper } = await start({ token: { admin: true }, ct: (ct) => ({ ...ct, values: () => new Promise(() => undefined) }) });
        expect(wrapper.find('main').text()).toBe(TEXT.loading);
    });

    it('row 2: nobody logged in to ChurchTools → no-access, no login', async () => {
        const { wrapper, assigned } = await start({ person: null, token: null });
        expect(wrapper.find('main').text()).toBe(TEXT.noAccess);
        expect(assigned).toEqual([]);
    });

    it('row 2: without the view right → no-access, even with a valid token', async () => {
        const { wrapper } = await start({ perms: { view: false }, token: { admin: true } });
        expect(wrapper.find('main').text()).toBe(TEXT.noAccess);
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('row 2: without the view right and without a token → no-access, no login and nothing asked of Auth', async () => {
        const { wrapper, assigned, calls } = await start({ perms: { view: false }, token: null });
        expect(wrapper.find('main').text()).toBe(TEXT.noAccess);
        expect(assigned).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('a ChurchTools failure shows settings editors no link to „Backend & Status“ and no sidebar', async () => {
        const { wrapper } = await start({ perms: EDITOR, ct: (ct) => ({ ...ct, values: () => Promise.reject(new Error('network')) }) });
        expect(wrapper.text()).toContain('ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.');
        expect(wrapper.find('a[href="/settings/backend"]').exists()).toBe(false);
        expect(wrapper.find('.cps-frame--card').exists()).toBe(true);
    });

    it('a ChurchTools failure is backend-error naming ChurchTools, not „not set up“', async () => {
        const { wrapper } = await start({ ct: (ct) => ({ ...ct, globalPermissions: () => Promise.reject(new Error('network')) }) });
        expect(wrapper.text()).toContain('ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.');
        expect(wrapper.text()).not.toContain(TEXT.waiting);
    });

    it('a ChurchTools rate limit names the minutes (8.3)', async () => {
        const { wrapper } = await start({
            ct: (ct) => ({ ...ct, values: () => Promise.reject(new CtRateLimitedError(150_000)) }),
        });
        expect(wrapper.text()).toContain('ChurchTools bremst gerade. Versuch es in 3 Minuten noch einmal.');
        expect(wrapper.find('button').exists()).toBe(false);
    });

    it('a ChurchTools rate limit of one minute says „einer Minute“ (8.3)', async () => {
        const { wrapper } = await start({
            ct: (ct) => ({ ...ct, values: () => Promise.reject(new CtRateLimitedError(30_000)) }),
        });
        expect(wrapper.text()).toContain('ChurchTools bremst gerade. Versuch es in einer Minute noch einmal.');
    });

    it('the session banner („Sitzung erneuern“) is part of the frame, on every page', async () => {
        const { wrapper, session } = await start({ token: { admin: false }, path: '/about', session: true });
        expect(wrapper.text()).not.toContain('Deine Sitzung ist abgelaufen.');
        session!.needsRenewal.value = true;
        await settle();
        expect(wrapper.find('main .cps-banner--warning').text()).toContain('Deine Sitzung ist abgelaufen.');
        expect(wrapper.findAll('button').some((b) => b.text() === 'Sitzung erneuern')).toBe(true);
    });

    it('row 3: old layout → waiting text, no login', async () => {
        const { wrapper, assigned } = await start({ settings: { adminUsers: [1], readAccessUsers: [2] }, token: null });
        expect(wrapper.find('main').text()).toBe(TEXT.waiting);
        expect(assigned).toEqual([]);
    });

    it('row 3: a setupCompleted category is the old layout', async () => {
        const { wrapper } = await start({ setupCompletedCategory: true });
        expect(wrapper.find('main').text()).toBe(TEXT.waiting);
    });

    it('row 3 alone stops the login: setupCompleted next to valid settings with backendUrl, no token', async () => {
        const { wrapper, assigned, calls } = await start({ setupCompletedCategory: true, token: null });
        expect(wrapper.find('main').text()).toBe(TEXT.waiting);
        expect(assigned).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('row 3 beats row 5: old layout without backendUrl is migration (waiting), setup-capable get the note', async () => {
        const { wrapper } = await start({ settings: { adminUsers: [1] }, perms: { 'create custom category': true } });
        expect(wrapper.text()).toContain(TEXT.waiting);
        expect(wrapper.text()).toContain(TEXT.setupNote);
    });

    it('row 4: newer settings schema → update-needed; no login', async () => {
        const { wrapper, assigned } = await start({ settings: { ...SETTINGS, schema: 3 }, token: null });
        expect(wrapper.find('main').text()).toBe(TEXT.update);
        expect(assigned).toEqual([]);
    });

    it('row 4: newer access schema → update-needed; settings editors see the versions', async () => {
        const { wrapper } = await start({ access: { ...ACCESS, schema: 5 }, perms: EDITOR, appVersion: '0.1.0' });
        expect(wrapper.text()).toContain(TEXT.update);
        expect(wrapper.text()).toContain('Gespeicherte Daten: Version 5. Diese Erweiterung (0.1.0) unterstützt Daten bis Version 2.');
    });

    it('row 4: a newer access schema also stops the login', async () => {
        const { wrapper, assigned, calls } = await start({ access: { ...ACCESS, schema: 3 }, perms: EDITOR, token: null });
        expect(wrapper.find('main').text()).toContain(TEXT.update);
        expect(assigned).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('row 4: setup-capable people who are no settings editors see the versions too (no login, so no admin claim)', async () => {
        const { wrapper } = await start({ settings: { ...SETTINGS, schema: 3 }, perms: { 'create custom category': true }, appVersion: '0.1.0' });
        expect(wrapper.text()).toContain(TEXT.update);
        expect(wrapper.text()).toContain('Gespeicherte Daten: Version 3. Diese Erweiterung (0.1.0) unterstützt Daten bis Version 2.');
    });

    it('row 4: users see no versions', async () => {
        const { wrapper } = await start({ settings: { ...SETTINGS, schema: 3 } });
        expect(wrapper.text()).not.toContain('Version');
    });

    it.each([
        ['missing settings', null],
        ['invalid settings', { ...SETTINGS, passwordLength: 5 }],
        ['settings without backendUrl', { ...SETTINGS, backendUrl: undefined }],
        ['settings without oauthClientId', { ...SETTINGS, oauthClientId: undefined }],
        ['broken JSON', '{nope'],
    ])('row 5 (%s): waiting text only, no login', async (_name, settings) => {
        const { wrapper, assigned } = await start({ settings, token: null });
        expect(wrapper.find('main').text()).toBe(TEXT.waiting);
        expect(assigned).toEqual([]);
    });

    it('row 5: setup-capable people see the waiting text and the note', async () => {
        const { wrapper } = await start({ settings: null, perms: { 'create custom category': true } });
        expect(wrapper.find('main').text()).toContain(TEXT.waiting);
        expect(wrapper.find('main').text()).toContain(TEXT.setupNote);
    });

    it('row 8: version mismatch, users see the short notice and no page', async () => {
        const { wrapper } = await start({ token: { admin: false, version: '0.2.0' }, appVersion: '0.1.0' });
        expect(wrapper.find('main').text()).toBe(TEXT.updating);
        expect(showsPasswordPage(wrapper)).toBe(false);
        expect(wrapper.find('footer').exists()).toBe(false);
    });

    it('row 8: admins see both versions', async () => {
        const { wrapper } = await start({ token: { admin: true, version: '0.2.0+abc' }, appVersion: '0.1.5' });
        expect(wrapper.text()).toContain('Erweiterung (Version 0.1.5) und Backend (Version 0.2.0+abc) passen nicht zusammen. Aktualisiere beide, sodass die ersten zwei Stellen der Versionsnummer übereinstimmen.');
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('row 8: build metadata is ignored', async () => {
        const { wrapper } = await start({ token: { admin: false, version: '0.1.0+abc-dirty' }, appVersion: '0.1.3' });
        expect(wrapper.find('h1').text()).toBe(TEXT.passwordTitle);
    });

    it('row 7 later: a login loop reported by the session turns the page into backend-error', async () => {
        const { wrapper, session } = await start({ token: { admin: true }, session: true });
        expect(wrapper.find('h1').text()).toBe(TEXT.passwordTitle);
        session!.loginLoop.value = true;
        await settle();
        expect(wrapper.text()).toContain(TEXT.loginFailed);
        expect(showsPasswordPage(wrapper)).toBe(false);
        expect(wrapper.find('nav').exists()).toBe(false);
    });

    it('rows 9 and 10 need no new login with a usable token', async () => {
        const { assigned, calls } = await start({ token: { admin: true } });
        expect(assigned).toEqual([]);
        expect(calls).not.toContain('startPageLogin');
    });
});

describe('reloadSettings (Task 12 point A)', () => {
    async function started() {
        const stored = { value: JSON.stringify(SETTINGS) };
        const built = await build({
            ct: (ct) => ({
                ...ct,
                values: async (moduleId, categoryId) =>
                    categoryId === SETTINGS_ID ? [{ id: 101, dataCategoryId: SETTINGS_ID, value: stored.value }] : ct.values(moduleId, categoryId),
            }),
        });
        const app = createAppState({
            services: built.services,
            router: built.router,
            session: createSession(built.auth, () => built.router.currentRoute.value.fullPath),
            callbackWindow: built.win,
            appVersion: '0.1.0',
        });
        await app.start();
        return { app, stored };
    }

    it('takes the new policy but keeps backendUrl and oauthClientId from startup', async () => {
        const { app, stored } = await started();
        stored.value = JSON.stringify({ ...SETTINGS, revision: 2, passwordLength: 20, backendUrl: 'https://evil.example', oauthClientId: 'other-client' });
        await app.reloadSettings();
        expect(app.settings.value).toMatchObject({ revision: 2, passwordLength: 20, backendUrl: BACKEND, oauthClientId: CLIENT });
    });

    it.each([
        ['invalid', { schema: 2, revision: 2, passwordLength: 'x' }],
        ['of a newer schema', { ...SETTINGS, schema: 99, revision: 2, passwordLength: 20 }],
    ])('keeps the old settings when the re-read is %s', async (_name, value) => {
        const { app, stored } = await started();
        const before = { ...app.settings.value };
        stored.value = JSON.stringify(value);
        await app.reloadSettings();
        expect(app.settings.value).toEqual(before);
    });
});

describe('the one ConfirmDialog', () => {
    it('is mounted once, on body inside a .cps wrapper, outside the app root', async () => {
        const { wrapper } = await start({ token: { admin: true } });
        void useConfirm()({ title: 'T', text: 'X', confirmLabel: 'OK', cancelLabel: 'Nein' });
        await settle();
        const dialogs = document.querySelectorAll('[role="alertdialog"]');
        expect(dialogs).toHaveLength(1);
        const host = dialogs[0]!.closest('.cps-app__dialogs')!;
        expect(host).not.toBeNull();
        expect(host.classList.contains('cps')).toBe(true);
        expect(host.parentElement).toBe(document.body);
        expect(wrapper.element.contains(dialogs[0]!)).toBe(false);
    });
});

