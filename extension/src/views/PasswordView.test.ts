/**
 * App layer (mounted): „Mein Passwort“ (spec 4.2) as the person sees it, with the real `Auth`, session and store over
 * the fake ChurchTools and the fake backend. Only the browser (storage, popup, clock) is faked.
 */
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createMemoryHistory, type Router } from 'vue-router';
import App from '../App.vue';
import { SERVICES_KEY, type Services } from '../app/services';
import { APP_STATE_KEY, type AppStateHandle } from '../app/useAppState';
import { SESSION_KEY, createSession, type Session } from '../app/useSession';
import type { BackendApi } from '../backend/api';
import { Auth, CALLBACK_WINDOW_KEY, TOKEN_KEY, type AuthEnv, type CallbackWindow } from '../backend/auth';
import { backendBase } from '../backend/http';
import type { CtApi } from '../ct/api';
import type { Permissions } from '../ct/types';
import { createFakeBackend, type FakeBackendOptions } from '../dev/fake-backend';
import { createFakeChurchTools } from '../dev/fake-churchtools';
import { createAppI18n } from '../i18n';
import { createAppRouter } from '../router';
import { ChurchToolsKv } from '../store/churchtools-kv';
import { ExtensionStore } from '../store/repository';
import { answerConfirm } from '../ui/useConfirm';
import PasswordView from './PasswordView.vue';

const ORIGIN = 'https://ct.example';
const BACKEND = 'https://pw.example';
const NOW = 1_800_000_000_000;
const ME = 1;
const SETTINGS_ID = 11;
const ACCESS_ID = 12;
const CT_PASSWORD = 'ct-password';
const VALID = 'Abcdefgh1234!xyz';

const TEXT = {
    isSet: '✓ Passwort ist gesetzt',
    none: 'Noch kein Passwort',
    cantShow: 'Aus Sicherheitsgründen können wir es dir nicht anzeigen. Wenn du es vergessen hast, setz einfach ein neues.',
    newPassword: 'Neues Passwort festlegen',
    setPassword: 'Passwort festlegen',
    replaceHint: 'Dein bisheriges Passwort funktioniert danach nicht mehr.',
    generate: 'Zufällig erzeugen',
    generateHelp: 'Empfohlen. Wir zeigen es dir einmal an.',
    custom: 'Selbst wählen',
    primaryLabel: 'Dein ChurchTools-Passwort (zur Bestätigung)',
    submitGenerate: 'Passwort erzeugen',
    submitCustom: 'Passwort speichern',
    cancel: 'Abbrechen',
    saved: '✓ Gespeichert',
    onlyNow: 'Du siehst es nur jetzt. Notier es dir oder speicher es in deinem Passwort-Manager.',
    done: 'Fertig',
    copy: 'Kopieren',
    sessionExpired: 'Deine Sitzung ist abgelaufen.',
    renew: 'Sitzung erneuern',
    unknown: 'Es ist unklar, ob das neue Passwort gespeichert wurde. Leg sicherheitshalber noch eins fest.',
    primaryMissing: 'Bitte gib dein ChurchTools-Passwort ein.',
    primaryWrong: 'Das ChurchTools-Passwort stimmt nicht.',
    title: 'Mein Zweitpasswort',
    intro: 'Ein eigenes Passwort für angebundene Dienste wie das WLAN. Es ist unabhängig von deinem ChurchTools-Passwort.',
};

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

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (sub: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: String(sub) })}.c2ln`;

interface Options {
    /** `allowCustomPassword`, `requirePasswordForPasswordChange`, `passwordLength`, `texts` (both sides agree). */
    allowCustom?: boolean;
    requirePrimary?: boolean;
    passwordLength?: number;
    texts?: unknown;
    /** Passwords stored in the backend, by person. */
    entries?: Record<number, string>;
    admin?: boolean;
    perms?: Partial<Permissions>;
    /** The person logged into ChurchTools (and in the token). */
    person?: number;
    /** Milliseconds the stored token is still valid. */
    tokenLeftMs?: number;
    backend?: FakeBackendOptions;
    path?: string;
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    answerConfirm({ confirmed: false });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

const perms = (p: Partial<Permissions> = {}): Permissions => ({
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

async function start(o: Options = {}) {
    const person = o.person ?? ME;
    const settings = {
        schema: 2,
        revision: 1,
        requirePasswordForPasswordChange: o.requirePrimary ?? false,
        allowCustomPassword: o.allowCustom ?? true,
        passwordLength: o.passwordLength ?? 16,
        backendUrl: BACKEND,
        oauthClientId: 'oauth-client-1',
        ...(o.texts === undefined ? {} : { texts: o.texts }),
    };
    /** What ChurchTools holds as `settings`; a test may change it (another admin saved). */
    const stored = { value: JSON.stringify(settings) };
    const fakeCt = createFakeChurchTools({
        moduleKey: 'ctpassstore',
        moduleId: 7,
        currentPersonId: person,
        persons: [{ id: person, firstName: 'Anna', lastName: 'Admin' }],
        groups: [],
        categories: [
            { id: SETTINGS_ID, name: 'settings', shorty: 'settings' },
            { id: ACCESS_ID, name: 'access', shorty: 'access' },
        ],
        values: [],
        permissions: perms(o.perms),
    });
    const ct: CtApi = {
        ...fakeCt,
        values: async (moduleId, categoryId) => {
            await fakeCt.values(moduleId, categoryId);
            return categoryId === SETTINGS_ID ? [{ id: 101, dataCategoryId: SETTINGS_ID, value: stored.value }] : [];
        },
    };
    const router: Router = createAppRouter(createMemoryHistory());
    const storage = new MemoryStorage();
    const clock = { now: NOW };
    const assigned: string[] = [];
    const open = vi.fn<AuthEnv['open']>(() => null);
    const env: AuthEnv = {
        origin: ORIGIN,
        instanceBaseUrl: ORIGIN,
        redirectPath: '/ccm/ctpassstore/auth/callback',
        storage: () => storage,
        assign: (url) => void assigned.push(url),
        open,
        listen: () => () => undefined,
        every: () => () => undefined,
        now: () => clock.now,
    };
    storage.setItem(
        TOKEN_KEY,
        JSON.stringify({ accessToken: jwt(person), expiresAt: NOW + (o.tokenLeftMs ?? 600_000), admin: o.admin ?? false, version: '0.1.0', backend: backendBase(BACKEND), person }),
    );
    const fakeBackend = createFakeBackend({
        personId: person,
        admin: o.admin ?? false,
        ctOrigin: ORIGIN,
        primaryPassword: CT_PASSWORD,
        requirePasswordForPasswordChange: settings.requirePasswordForPasswordChange,
        allowCustomPassword: settings.allowCustomPassword,
        passwordLength: settings.passwordLength,
        version: '0.1.0',
        entries: o.entries ?? {},
        ...o.backend,
    });
    const api: BackendApi = fakeBackend;
    const calls = { get: 0, put: 0 };
    const counted: BackendApi = {
        ...api,
        getEntry: (id) => (calls.get++, api.getEntry(id)),
        putEntry: (id, body) => (calls.put++, api.putEntry(id, body)),
    };
    const auth = new Auth(() => counted, env);
    const session = createSession(auth, () => router.currentRoute.value.fullPath);
    const services: Services = {
        session,
        ct,
        store: new ExtensionStore(new ChurchToolsKv(ct, 'ctpassstore')),
        auth,
        backend: () => counted,
        language: 'de',
        appVersion: '0.1.0',
    };
    const win: CallbackWindow = { opener: null, origin: ORIGIN, close: vi.fn() };
    await router.push(o.path ?? '/');
    const wrapper = mount(App, {
        attachTo: document.body,
        global: { plugins: [router, createAppI18n('de')], provide: { [SERVICES_KEY as symbol]: services, [CALLBACK_WINDOW_KEY as symbol]: win } },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, router, fakeBackend, session, auth, clock, open, assigned, calls, stored, settings };
}

/** Startup awaits real Web Crypto as well as promises, so a few macrotasks are needed. */
async function settle() {
    for (let i = 0; i < 10; i++) {
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    }
}

const button = (w: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> | undefined => w.findAll('button').find((b) => b.text() === text);
async function click(w: VueWrapper, text: string) {
    const b = button(w, text);
    if (!b) throw new Error(`No button „${text}“ in: ${w.text()}`);
    await b.trigger('click');
    await settle();
}
const customInput = (w: VueWrapper) => w.find<HTMLInputElement>('input[autocomplete="new-password"]');
const primaryInput = (w: VueWrapper) => w.find<HTMLInputElement>('input[autocomplete="current-password"]');
const ruleStates = (w: VueWrapper) => Object.fromEntries(w.findAll('.cps-rules li').map((li) => [li.attributes('data-rule'), li.attributes('data-state')]));
const resultInput = (w: VueWrapper) => w.find<HTMLInputElement>('.cps-flow__result input');
const errorAbove = (w: VueWrapper) => w.find('.cps-flow__error');
/** Every value and text on the page, to make sure a password is gone. */
const everything = (w: VueWrapper) => w.html() + w.findAll('input').map((i) => (i.element as HTMLInputElement).value).join('|');

async function chooseCustom(w: VueWrapper, password: string) {
    await w.find('input[type="radio"][value="custom"]').setValue(true);
    await customInput(w).setValue(password);
}

describe('state 1, overview', () => {
    it('shows the page texts from the settings with a key icon', async () => {
        const { wrapper } = await start();
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(wrapper.text()).toContain(TEXT.intro);
    });

    it('shows custom texts as plain text, never as HTML or as a message', async () => {
        const { wrapper } = await start({ texts: { de: { title: '<b>WLAN</b> {name} @:app.name', intro: 'Hallo <i>du</i> | {n}' } } });
        expect(wrapper.find('h1').text()).toBe('<b>WLAN</b> {name} @:app.name');
        expect(wrapper.text()).toContain('Hallo <i>du</i> | {n}');
        expect(wrapper.find('h1 b').exists()).toBe(false);
        expect(wrapper.find('main i').exists()).toBe(false);
    });

    it('with an entry: „Passwort ist gesetzt“, why it is not shown, the button and the hint', async () => {
        const { wrapper } = await start({ entries: { [ME]: VALID } });
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
        expect(wrapper.text()).toContain(TEXT.cantShow);
        expect(button(wrapper, TEXT.newPassword)).toBeDefined();
        expect(wrapper.text()).toContain(TEXT.replaceHint);
    });

    it('without an entry: „Noch kein Passwort“, „Passwort festlegen“, no hint', async () => {
        const { wrapper } = await start();
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.none);
        expect(button(wrapper, TEXT.setPassword)).toBeDefined();
        expect(button(wrapper, TEXT.newPassword)).toBeUndefined();
        expect(wrapper.text()).not.toContain(TEXT.replaceHint);
        expect(wrapper.text()).not.toContain(TEXT.cantShow);
    });

    it('has no delete button for one‘s own password (E9)', async () => {
        const { wrapper } = await start({ entries: { [ME]: VALID } });
        expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('Löschen');
        expect(wrapper.find('.cps-btn--danger').exists()).toBe(false);
    });

    it('asks only for the logged-in person, never a person from the address', async () => {
        const { wrapper, calls } = await start({ person: 7, entries: { 7: VALID, 1: VALID }, path: '/?personId=1' });
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
        expect(calls.get).toBe(1);
        const other = await start({ person: 7, entries: { 1: VALID } });
        expect(other.wrapper.find('.cps-pill').text()).toBe(TEXT.none);
    });

    it('any other answer is an error, never „Noch kein Passwort“ (spec 4.2)', async () => {
        const { wrapper } = await startFailingGet('upstream-unavailable', 503);
        expect(wrapper.text()).toContain('ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.');
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain(TEXT.none);
        expect(wrapper.text()).not.toContain(TEXT.isSet);
        expect(button(wrapper, TEXT.setPassword)).toBeUndefined();
        expect(button(wrapper, TEXT.newPassword)).toBeUndefined();
    });

    it('a status error can be retried', async () => {
        const { wrapper } = await startFailingGet('upstream-unavailable', 503);
        await click(wrapper, 'Erneut versuchen');
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.none);
    });

    it('the technical detail is only for admins, as plain text', async () => {
        const user = await startFailingGet('misconfigured', 500, '<b>BACKEND_KEY</b> missing');
        expect(user.wrapper.text()).toContain('Der Dienst ist noch nicht richtig eingerichtet.');
        expect(user.wrapper.find('details').exists()).toBe(false);
        expect(user.wrapper.text()).not.toContain('BACKEND_KEY');
        const admin = await startFailingGet('misconfigured', 500, '<b>BACKEND_KEY</b> missing', { admin: true });
        expect(admin.wrapper.find('main details').text()).toContain('<b>BACKEND_KEY</b> missing');
        expect(admin.wrapper.find('main details b').exists()).toBe(false);
    });
});

/** A start whose first `GET /entries` fails with the given problem. */
async function startFailingGet(slug: string, status: number, detail?: string, o: Options = {}) {
    // The fake's failNext must be armed before the page loads: start elsewhere, arm it, then open the page.
    const s = await start({ ...o, path: '/about' });
    s.fakeBackend.failNext(slug, status, detail === undefined ? {} : { detail });
    await s.router.push('/');
    await settle();
    return s;
}

describe('the button’s target', () => {
    it('renews the session inside the click handler before opening the form', async () => {
        const { wrapper, session } = await start();
        const fresh = vi.spyOn(session, 'ensureFresh');
        await click(wrapper, TEXT.setPassword);
        expect(fresh).toHaveBeenCalledTimes(1);
    });

    it('without choice and confirmation it generates right away and shows state 3 (direct path)', async () => {
        const { wrapper, fakeBackend, calls } = await start({ allowCustom: false, requirePrimary: false });
        await click(wrapper, TEXT.setPassword);
        expect(calls.put).toBe(1);
        const stored = fakeBackend.entries.get(ME)!;
        expect(stored).toMatch(/^.{16}$/);
        expect(resultInput(wrapper).element.value).toBe(stored);
        expect(wrapper.find('.cps-flow__result .cps-pill').text()).toBe(TEXT.saved);
        expect(wrapper.find('input[type="radio"]').exists()).toBe(false);
    });

    it.each([
        [true, false],
        [true, true],
        [false, true],
    ])('allowCustom %s, requirePrimary %s: state 2, nothing sent yet', async (allowCustom, requirePrimary) => {
        const { wrapper, calls } = await start({ allowCustom, requirePrimary });
        await click(wrapper, TEXT.setPassword);
        expect(calls.put).toBe(0);
        expect(button(wrapper, TEXT.submitGenerate)).toBeDefined();
        expect(button(wrapper, TEXT.cancel)).toBeDefined();
    });
});

describe('state 2, set a new one', () => {
    it('offers „Zufällig erzeugen“ (default, with its help) and „Selbst wählen“', async () => {
        const { wrapper } = await start({ allowCustom: true });
        await click(wrapper, TEXT.setPassword);
        const cards = wrapper.findAll('.cps-choice');
        expect(cards.map((c) => c.find('.cps-choice__label').text())).toEqual([TEXT.generate, TEXT.custom]);
        expect(cards[0]!.text()).toContain(TEXT.generateHelp);
        expect((wrapper.find('input[type="radio"][value="generate"]').element as HTMLInputElement).checked).toBe(true);
        expect(customInput(wrapper).exists()).toBe(false);
    });

    it('„Selbst wählen“ is absent when custom passwords are not allowed', async () => {
        const { wrapper } = await start({ allowCustom: false, requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        expect(wrapper.text()).not.toContain(TEXT.custom);
        expect(wrapper.find('input[type="radio"][value="custom"]').exists()).toBe(false);
        expect(customInput(wrapper).exists()).toBe(false);
    });

    it('the custom field has an eye and the rule list, ticked off live', async () => {
        const { wrapper } = await start({ passwordLength: 14 });
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, 'abc');
        expect(wrapper.find('button[aria-label="Passwort anzeigen"]').exists()).toBe(true);
        const list = wrapper.find('.cps-rules');
        expect(list.attributes('aria-live')).toBe('polite');
        expect(list.text()).toContain('Mindestens 14 Zeichen (höchstens 128)');
        expect(list.text()).toContain('! @ $ % & * - _ + = ? .');
        expect(ruleStates(wrapper)).toEqual({ length: 'open', letter: 'ok', digit: 'open', symbol: 'open', chars: 'ok' });
        await customInput(wrapper).setValue('abc1!');
        expect(ruleStates(wrapper)).toEqual({ length: 'open', letter: 'ok', digit: 'ok', symbol: 'ok', chars: 'ok' });
        await customInput(wrapper).setValue('Abcdefgh12345!');
        expect(ruleStates(wrapper)).toEqual({ length: 'ok', letter: 'ok', digit: 'ok', symbol: 'ok', chars: 'ok' });
    });

    it('a trailing space fails „keine anderen Zeichen“ and is named; nothing is trimmed', async () => {
        const { wrapper } = await start({ passwordLength: 14 });
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, 'Abcdefgh12345! ');
        expect(ruleStates(wrapper).chars).toBe('failed');
        expect(wrapper.find('.cps-rules').text()).toContain('Nicht erlaubt: Leerzeichen');
        expect(customInput(wrapper).element.value).toBe('Abcdefgh12345! ');
        expect(button(wrapper, TEXT.submitCustom)!.attributes('disabled')).toBeDefined();
    });

    it('a password over 128 characters fails the length rule', async () => {
        const { wrapper } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, `Ab1!${'x'.repeat(125)}`);
        expect(ruleStates(wrapper).length).toBe('failed');
    });

    it('asks for the ChurchTools password when required, with an eye', async () => {
        const { wrapper } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        expect(wrapper.text()).toContain(TEXT.primaryLabel);
        expect(primaryInput(wrapper).exists()).toBe(true);
        expect(wrapper.findAll('button[aria-label="Passwort anzeigen"]').length).toBeGreaterThanOrEqual(1);
    });

    it('no ChurchTools password field when it is not required', async () => {
        const { wrapper } = await start({ requirePrimary: false });
        await click(wrapper, TEXT.setPassword);
        expect(primaryInput(wrapper).exists()).toBe(false);
    });

    it('the submit button stays disabled until the input is complete, and a hint says why', async () => {
        const { wrapper } = await start({ requirePrimary: true, passwordLength: 14 });
        await click(wrapper, TEXT.setPassword);
        const submit = () => button(wrapper, TEXT.submitGenerate) ?? button(wrapper, TEXT.submitCustom)!;
        expect(submit().attributes('disabled')).toBeDefined();
        const hint = wrapper.find(`#${submit().attributes('aria-describedby')}`);
        expect(hint.text()).toBe(TEXT.primaryMissing);
        await primaryInput(wrapper).setValue(CT_PASSWORD);
        expect(submit().attributes('disabled')).toBeUndefined();
        await chooseCustom(wrapper, 'short');
        expect(submit().attributes('disabled')).toBeDefined();
        expect(wrapper.find(`#${submit().attributes('aria-describedby')}`).text()).toBe('Das Passwort erfüllt die Regeln nicht.');
        await customInput(wrapper).setValue('Abcdefgh12345!');
        expect(submit().attributes('disabled')).toBeUndefined();
    });

    it('„Abbrechen“ returns to state 1, sends nothing and forgets what was typed', async () => {
        const { wrapper, calls } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await primaryInput(wrapper).setValue(CT_PASSWORD);
        await chooseCustom(wrapper, VALID);
        await click(wrapper, TEXT.cancel);
        expect(calls.put).toBe(0);
        expect(everything(wrapper)).not.toContain(VALID);
        expect(everything(wrapper)).not.toContain(CT_PASSWORD);
        await click(wrapper, TEXT.setPassword);
        expect(primaryInput(wrapper).element.value).toBe('');
    });

    it('renews the session inside the submit handler, then sends', async () => {
        const { wrapper, session, calls } = await start();
        await click(wrapper, TEXT.setPassword);
        const fresh = vi.spyOn(session, 'ensureFresh');
        const call = vi.spyOn(session, 'call');
        await click(wrapper, TEXT.submitGenerate);
        expect(fresh).toHaveBeenCalledTimes(1);
        expect(call).toHaveBeenCalled();
        expect(fresh.mock.invocationCallOrder[0]!).toBeLessThan(call.mock.invocationCallOrder[0]!);
        expect(calls.put).toBe(1);
    });

    it('sends the ChurchTools password with the request', async () => {
        const { wrapper, fakeBackend } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await primaryInput(wrapper).setValue(CT_PASSWORD);
        await click(wrapper, TEXT.submitGenerate);
        expect(fakeBackend.entries.has(ME)).toBe(true);
    });
});

describe('state 3, result', () => {
    it('generated: „Gespeichert“, the password in a monospace field with copy inside, the warning and „Fertig“', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        const result = wrapper.find('.cps-flow__result');
        expect(result.find('.cps-pill').text()).toBe(TEXT.saved);
        const input = resultInput(wrapper);
        expect(input.element.value).toBe(fakeBackend.entries.get(ME));
        expect(input.attributes('type')).toBe('text');
        expect(input.attributes('readonly')).toBeDefined();
        expect(input.classes()).toContain('cps-secret__input--mono');
        expect(result.find('.cps-secret__box button[aria-label="Kopieren"]').exists()).toBe(true);
        expect(result.find('.cps-banner--warning').text()).toBe(TEXT.onlyNow);
        expect(button(wrapper, TEXT.done)).toBeDefined();
        expect(button(wrapper, TEXT.submitGenerate)).toBeUndefined();
    });

    it('„Fertig“ returns to state 1 and drops the plaintext', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        const password = fakeBackend.entries.get(ME)!;
        await click(wrapper, TEXT.done);
        expect(everything(wrapper)).not.toContain(password);
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
        expect(wrapper.text()).toContain(TEXT.replaceHint);
    });

    it('leaving the page drops the plaintext; coming back shows state 1', async () => {
        const { wrapper, router, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        const password = fakeBackend.entries.get(ME)!;
        await router.push('/about');
        await settle();
        expect(everything(wrapper)).not.toContain(password);
        await router.push('/');
        await settle();
        expect(everything(wrapper)).not.toContain(password);
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
    });

    it('the plaintext never reaches storage or the address', async () => {
        const { wrapper, router, fakeBackend } = await start();
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const log = vi.spyOn(console, 'log');
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        const password = fakeBackend.entries.get(ME)!;
        expect(router.currentRoute.value.fullPath).toBe('/');
        expect(setItem.mock.calls.flat().join('|')).not.toContain(password);
        expect(log.mock.calls.flat().join('|')).not.toContain(password);
    });

    it('chosen: „Gespeichert“ inline as a status, back to state 1, the typed password gone', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        await click(wrapper, TEXT.submitCustom);
        expect(fakeBackend.entries.get(ME)).toBe(VALID);
        expect(wrapper.find('[role="status"].cps-password__saved').text()).toBe(TEXT.saved);
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
        expect(everything(wrapper)).not.toContain(VALID);
        expect(customInput(wrapper).exists()).toBe(false);
    });

    it('custom and ChurchTools fields use new-password and current-password', async () => {
        const { wrapper } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, '');
        expect(customInput(wrapper).exists()).toBe(true);
        expect(primaryInput(wrapper).exists()).toBe(true);
    });
});

describe('problems (spec 8.2)', () => {
    it('invalid-primary-password shows at the ChurchTools field and keeps what was typed', async () => {
        const { wrapper } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await primaryInput(wrapper).setValue('wrong');
        await chooseCustom(wrapper, VALID);
        await click(wrapper, TEXT.submitCustom);
        const error = wrapper.find(`#${primaryInput(wrapper).attributes('aria-describedby')}`);
        expect(error.text()).toBe(TEXT.primaryWrong);
        expect(error.attributes('role')).toBe('alert');
        expect(primaryInput(wrapper).attributes('aria-invalid')).toBe('true');
        expect(customInput(wrapper).element.value).toBe(VALID);
        expect(errorAbove(wrapper).exists()).toBe(false);
    });

    it('the field error goes away once the ChurchTools password is changed', async () => {
        const { wrapper } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await primaryInput(wrapper).setValue('wrong');
        await click(wrapper, TEXT.submitGenerate);
        expect(wrapper.text()).toContain(TEXT.primaryWrong);
        await primaryInput(wrapper).setValue(CT_PASSWORD);
        expect(wrapper.text()).not.toContain(TEXT.primaryWrong);
    });

    it('password-invalid marks the rules the backend returned', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        fakeBackend.failNext('password-invalid', 400, { violations: ['missing-symbol', 'too-short'] });
        await click(wrapper, TEXT.submitCustom);
        expect(ruleStates(wrapper)).toEqual({ length: 'failed', letter: 'ok', digit: 'ok', symbol: 'failed', chars: 'ok' });
        expect(errorAbove(wrapper).text()).toBe('Das Passwort erfüllt die Regeln nicht.');
        await customInput(wrapper).setValue(`${VALID}a`);
        expect(ruleStates(wrapper).symbol).toBe('ok');
    });

    it.each([
        [125, 3],
        [0, 1],
        [999_999, 60],
    ])('too-many-attempts with retryAfter %s shows %s minutes', async (retryAfter, minutes) => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        fakeBackend.failNext('too-many-attempts', 429, { retryAfter });
        await click(wrapper, TEXT.submitGenerate);
        expect(errorAbove(wrapper).text()).toBe(`Zu viele Versuche. Versuch es in ${minutes} Minuten noch einmal.`);
        expect(errorAbove(wrapper).attributes('role')).toBe('alert');
    });

    it('custom-password-not-allowed says so and reloads the settings: the choice disappears', async () => {
        const { wrapper, fakeBackend, stored, settings } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        stored.value = JSON.stringify({ ...settings, revision: 2, allowCustomPassword: false });
        fakeBackend.setSettings({ allowCustomPassword: false });
        await click(wrapper, TEXT.submitCustom);
        expect(errorAbove(wrapper).text()).toBe('Eigene Passwörter sind gerade nicht erlaubt.');
        expect(wrapper.find('input[type="radio"][value="custom"]').exists()).toBe(false);
        expect(everything(wrapper)).not.toContain(VALID);
        expect(button(wrapper, TEXT.submitGenerate)!.attributes('disabled')).toBeUndefined();
    });

    it('timeout on generate warns that the outcome is unknown', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        fakeBackend.breakNext('unreachable', { afterWrite: true });
        await click(wrapper, TEXT.submitGenerate);
        const stored = fakeBackend.entries.get(ME)!;
        expect(stored).toBeDefined();
        expect(wrapper.text()).toContain(TEXT.unknown);
        expect(wrapper.text()).not.toContain(TEXT.saved);
        expect(wrapper.text()).not.toContain('nicht erreichbar');
        expect(everything(wrapper)).not.toContain(stored);
        // Generating again is right there.
        expect(button(wrapper, TEXT.submitGenerate)!.attributes('disabled')).toBeUndefined();
        // The status was reloaded behind the form: after „Abbrechen“ it says what the backend has now.
        await click(wrapper, TEXT.cancel);
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
    });

    it('an answer off the contract after saving a chosen password is also an unknown outcome', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        fakeBackend.breakNext('unexpected', { afterWrite: true });
        await click(wrapper, TEXT.submitCustom);
        expect(wrapper.text()).toContain(TEXT.unknown);
        expect(wrapper.text()).not.toContain(TEXT.saved);
        expect(customInput(wrapper).element.value).toBe(VALID);
    });

    it('forbidden shows its text above the button', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        fakeBackend.failNext('forbidden', 403);
        await click(wrapper, TEXT.submitGenerate);
        expect(errorAbove(wrapper).text()).toBe('Dafür hast du keine Berechtigung.');
    });
});

describe('session (spec 7.2)', () => {
    it('token expiry does not clear the shown password', async () => {
        const { wrapper, fakeBackend, auth, session, clock } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        const password = fakeBackend.entries.get(ME)!;
        // The token runs out and is dropped; the session asks for a renewal.
        clock.now += 3_600_000;
        fakeBackend.expireToken();
        auth.clear();
        session.needsRenewal.value = true;
        await settle();
        expect(resultInput(wrapper).element.value).toBe(password);
        expect(wrapper.text()).toContain(TEXT.onlyNow);
        expect(wrapper.text()).toContain(TEXT.sessionExpired);
        await click(wrapper, TEXT.renew);
        expect(resultInput(wrapper).element.value).toBe(password);
    });

    it('a shown password counts as unsaved: an invalid token then asks for renewal instead of leaving the page', async () => {
        const { wrapper, fakeBackend, session, assigned } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        const password = fakeBackend.entries.get(ME)!;
        fakeBackend.failNext('invalid-token', 401);
        await session.call(() => fakeBackend.getEntry(ME)).catch(() => undefined);
        await settle();
        expect(assigned).toEqual([]);
        expect(resultInput(wrapper).element.value).toBe(password);
        expect(wrapper.text()).toContain(TEXT.sessionExpired);
    });

    it('a blocked renewal popup on submit shows „Sitzung erneuern“ and keeps the typed password', async () => {
        const { wrapper, calls, clock, open } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await primaryInput(wrapper).setValue(CT_PASSWORD);
        await chooseCustom(wrapper, VALID);
        clock.now += 540_000; // 60 s left: the submit renews first, and the popup is blocked.
        await click(wrapper, TEXT.submitCustom);
        expect(open).toHaveBeenCalled();
        expect(calls.put).toBe(0);
        const banner = wrapper.find('.cps-banner--warning');
        expect(banner.text()).toContain(TEXT.sessionExpired);
        expect(button(wrapper, TEXT.renew)).toBeDefined();
        expect(customInput(wrapper).element.value).toBe(VALID);
        expect(primaryInput(wrapper).element.value).toBe(CT_PASSWORD);
        expect(errorAbove(wrapper).exists()).toBe(false);
        // „Sitzung erneuern“ tries the popup again from the click.
        open.mockClear();
        await click(wrapper, TEXT.renew);
        expect(open).toHaveBeenCalledTimes(1);
        expect(customInput(wrapper).element.value).toBe(VALID);
    });

    it('token-expired on submit with a blocked popup keeps the input as well', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        fakeBackend.expireToken();
        await click(wrapper, TEXT.submitCustom);
        expect(wrapper.text()).toContain(TEXT.sessionExpired);
        expect(customInput(wrapper).element.value).toBe(VALID);
        expect(fakeBackend.entries.has(ME)).toBe(false);
    });
});

describe('the page checks its own rights', () => {
    function mountAlone(state: AppStateHandle['state']['value'], personId: number | null) {
        const getEntry = vi.fn(async () => 'none' as const);
        const backend = vi.fn(() => ({ getEntry }) as unknown as BackendApi);
        const services = { backend, language: 'de' } as unknown as Services;
        const session = {
            needsRenewal: ref(false),
            admin: ref(false),
            call: <T,>(fn: () => Promise<T>) => fn(),
            ensureFresh: async () => undefined,
            trackUnsaved: () => () => undefined,
        } as unknown as Session;
        const app = {
            state: ref(state),
            personId: ref(personId),
            settings: ref({ schema: 2, revision: 1, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16, backendUrl: BACKEND, oauthClientId: 'c' }),
            settingsEditor: ref({ settings: false, access: false }),
            admin: ref(false),
        } as unknown as AppStateHandle;
        const wrapper = mount(PasswordView, {
            global: {
                plugins: [createAppI18n('de')],
                provide: { [SERVICES_KEY as symbol]: services, [SESSION_KEY as symbol]: session, [APP_STATE_KEY as symbol]: app },
            },
        });
        mounted.push(wrapper);
        return { wrapper, getEntry, backend };
    }

    it.each(['backend-error', 'no-access', 'loading', 'setup-needed'] as const)('in %s it loads nothing and names the missing access', async (state) => {
        const { wrapper, getEntry, backend } = mountAlone(state, ME);
        await settle();
        expect(backend).not.toHaveBeenCalled();
        expect(getEntry).not.toHaveBeenCalled();
        expect(wrapper.find('.cps-banner--warning').text()).toBe('Du hast keinen Zugriff auf diese Erweiterung. Wende dich an die Verantwortlichen in deiner Gemeinde.');
        expect(wrapper.find('button').exists()).toBe(false);
    });

    it('without a known person it loads nothing', async () => {
        const { getEntry } = mountAlone('user', null);
        await settle();
        expect(getEntry).not.toHaveBeenCalled();
    });

    it('as a user it loads the person’s own status', async () => {
        const { getEntry } = mountAlone('user', 5);
        await settle();
        expect(getEntry).toHaveBeenCalledWith(5);
    });
});
