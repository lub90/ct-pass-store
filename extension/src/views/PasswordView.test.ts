/**
 * App layer (mounted): „Mein Passwort“ (spec 4.2) as the person sees it, with the real `Auth`, session and store over
 * the fake ChurchTools and the fake backend. Only the browser (storage, popup, clock) is faked.
 */
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createMemoryHistory, type Router } from 'vue-router';
import App from '../App.vue';
import { SERVICES_KEY, backendFor, type Services } from '../app/services';
import { APP_STATE_KEY, type AppStateHandle } from '../app/useAppState';
import { SESSION_KEY, createSession, type Session } from '../app/useSession';
import type { BackendApi } from '../backend/api';
import { Auth, CALLBACK_WINDOW_KEY, TOKEN_KEY, type AuthEnv, type CallbackWindow } from '../backend/auth';
import { backendBase } from '../backend/http';
import type { CtApi } from '../ct/api';
import type { Permissions } from '../ct/types';
import { createFakeBackend, type FakeBackendOptions } from '../dev/fake-backend';
import { createFakeChurchTools } from '../dev/fake-churchtools';
import { BackendUnreachable } from '../backend/problems';
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
    /** The app's real backend client (over `fetch`, which the test stubs) instead of the fake backend. */
    realBackend?: boolean;
}

/** ChurchTools rights of a settings editor who is no admin (spec 3.1). */
const EDITOR: Partial<Permissions> = { 'view custom data': [SETTINGS_ID, ACCESS_ID], 'edit custom data': [SETTINGS_ID, ACCESS_ID] };

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
    /** The bodies of the PUTs as the app sent them. */
    const puts: Record<string, unknown>[] = [];
    /** While set, a PUT waits for it before it reaches the backend (a slow request). */
    const gate: { hold: Promise<void> | null } = { hold: null };
    const counted: BackendApi = {
        ...api,
        getEntry: (id) => (calls.get++, api.getEntry(id)),
        putEntry: async (id, body) => {
            calls.put++;
            puts.push({ ...body });
            if (gate.hold) await gate.hold;
            return api.putEntry(id, body);
        },
    };
    /** Holds the next PUTs; the returned function lets them through. */
    const holdPuts = (): (() => void) => {
        let release = (): void => undefined;
        gate.hold = new Promise<void>((resolve) => (release = resolve));
        return () => {
            gate.hold = null;
            release();
        };
    };
    const auth = new Auth(() => counted, env);
    const session = createSession(auth, () => router.currentRoute.value.fullPath);
    const backend = o.realBackend ? backendFor(auth) : () => counted;
    const services: Services = {
        session,
        ct,
        store: new ExtensionStore(new ChurchToolsKv(ct, 'ctpassstore')),
        auth,
        backend,
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
    return { wrapper, router, fakeBackend, session, auth, clock, open, assigned, calls, puts, stored, settings, holdPuts, storage };
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
/** A click dispatched synchronously, as the browser does: whatever the handler runs before its first await has run on return. */
function clickNow(w: VueWrapper, text: string) {
    const b = button(w, text);
    if (!b) throw new Error(`No button „${text}“ in: ${w.text()}`);
    b.element.click();
}
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

    it('while masked, disallowed characters are named by kind, never echoed', async () => {
        const { wrapper } = await start({ passwordLength: 14 });
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, 'Abcdefgh12345! ä#\t\u200b');
        const named = wrapper.find('.cps-rules__named').text();
        expect(named).toContain('Leerzeichen');
        expect(named).toContain('Umlaute und Zeichen außerhalb von ASCII');
        expect(named).toContain('Sonderzeichen, die nicht in der Liste stehen');
        expect(named).toContain('Steuerzeichen');
        expect(named).not.toContain('ä');
        expect(named).not.toContain('#');
        expect(named).not.toContain('U+');
    });

    it('while revealed, disallowed characters are named; invisible ones as U+XXXX, never as an empty „“', async () => {
        const { wrapper } = await start({ passwordLength: 14 });
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, 'Abcdefgh12345! ä#\t\u200b\u0007');
        await wrapper.find('button[aria-label="Passwort anzeigen"]').trigger('click');
        const named = wrapper.find('.cps-rules__named').text();
        expect(named).toContain('Leerzeichen');
        expect(named).toContain('„ä“');
        expect(named).toContain('„#“');
        expect(named).toContain('Tabulator');
        expect(named).toContain('U+200B');
        expect(named).toContain('U+0007');
        expect(named).not.toMatch(/„\s*“/);
        expect(named).not.toContain('\u200b');
        // Hidden again: back to kinds.
        await wrapper.find('button[aria-label="Passwort verbergen"]').trigger('click');
        expect(wrapper.find('.cps-rules__named').text()).not.toContain('ä');
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
        [125, 'in 3 Minuten'],
        [60, 'in einer Minute'],
        [0, 'in einer Minute'],
        [999_999, 'in 60 Minuten'],
    ])('too-many-attempts with retryAfter %s says „%s“', async (retryAfter, minutes) => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        fakeBackend.failNext('too-many-attempts', 429, { retryAfter });
        await click(wrapper, TEXT.submitGenerate);
        expect(errorAbove(wrapper).text()).toBe(`Zu viele Versuche. Versuch es ${minutes} noch einmal.`);
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

describe('a slow request (review of Task 12)', () => {
    it('„Abbrechen“ is disabled while the request runs', async () => {
        const { wrapper, holdPuts } = await start();
        await click(wrapper, TEXT.setPassword);
        const release = holdPuts();
        await click(wrapper, TEXT.submitGenerate);
        expect(button(wrapper, TEXT.cancel)!.attributes('disabled')).toBeDefined();
        release();
        await settle();
        expect(resultInput(wrapper).exists()).toBe(true);
    });

    it('direct path: a loading line instead of the form while the request runs', async () => {
        const { wrapper, holdPuts, fakeBackend } = await start({ allowCustom: false, requirePrimary: false });
        const release = holdPuts();
        await click(wrapper, TEXT.setPassword);
        expect(wrapper.find('.cps-flow [role="status"]').text()).toBe('Passwort wird erzeugt …');
        expect(button(wrapper, TEXT.submitGenerate)).toBeUndefined();
        expect(button(wrapper, TEXT.cancel)).toBeUndefined();
        release();
        await settle();
        expect(resultInput(wrapper).element.value).toBe(fakeBackend.entries.get(ME));
    });

    it('direct path: a failure leaves the retry surface', async () => {
        const { wrapper, fakeBackend } = await start({ allowCustom: false, requirePrimary: false });
        fakeBackend.failNext('forbidden', 403);
        await click(wrapper, TEXT.setPassword);
        expect(errorAbove(wrapper).text()).toBe('Dafür hast du keine Berechtigung.');
        await click(wrapper, TEXT.submitGenerate);
        expect(resultInput(wrapper).exists()).toBe(true);
    });

    it.each([
        ['after the request landed', true],
        ['before the request landed', false],
    ])('leaving during a pending PUT and coming back %s: the pill matches the backend', async (_name, releaseFirst) => {
        const { wrapper, router, holdPuts, fakeBackend } = await start({ allowCustom: false, requirePrimary: false });
        const release = holdPuts();
        await click(wrapper, TEXT.setPassword);
        await router.push('/about');
        await settle();
        if (releaseFirst) {
            release();
            await settle();
        }
        await router.push('/');
        await settle();
        if (!releaseFirst) {
            expect(wrapper.find('.cps-pill').text()).toBe(TEXT.none);
            release();
            await settle();
        }
        expect(fakeBackend.entries.has(ME)).toBe(true);
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
        expect(everything(wrapper)).not.toContain(fakeBackend.entries.get(ME)!);
    });

    it('leaving the flow reads the status again', async () => {
        const { wrapper, fakeBackend } = await start();
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.none);
        await click(wrapper, TEXT.setPassword);
        // Meanwhile an admin set one (another tab, another person).
        await fakeBackend.putEntry(ME, { secondaryPwd: VALID });
        await click(wrapper, TEXT.cancel);
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
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

    it('token-expired again right after a successful renewal is not silent', async () => {
        const { wrapper, fakeBackend, auth, calls } = await start();
        vi.spyOn(auth, 'loginInPopup').mockResolvedValue(undefined);
        await click(wrapper, TEXT.setPassword);
        fakeBackend.expireToken();
        await click(wrapper, TEXT.submitGenerate);
        expect(calls.put).toBe(2);
        expect(errorAbove(wrapper).text()).toBe('Deine Anmeldung ist abgelaufen. Lade die Seite neu.');
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
    const SETTINGS = { schema: 2, revision: 1, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16, backendUrl: BACKEND, oauthClientId: 'c' };
    function mountAlone(state: AppStateHandle['state']['value'], personId: number | null, settings: unknown = SETTINGS) {
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
            settings: ref(settings),
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

    it('without a known person it loads nothing and names the missing access', async () => {
        const { wrapper, getEntry } = mountAlone('user', null);
        await settle();
        expect(getEntry).not.toHaveBeenCalled();
        expect(wrapper.find('.cps-banner--warning').exists()).toBe(true);
    });

    it('without settings it loads nothing and names the missing access', async () => {
        const { wrapper, getEntry, backend } = mountAlone('user', 5, null);
        await settle();
        expect(backend).not.toHaveBeenCalled();
        expect(getEntry).not.toHaveBeenCalled();
        expect(wrapper.find('.cps-banner--warning').exists()).toBe(true);
    });

    it.each(['user', 'admin'] as const)('as %s it loads the person’s own status', async (state) => {
        const { wrapper, getEntry } = mountAlone(state, 5);
        await settle();
        expect(getEntry).toHaveBeenCalledWith(5);
        expect(wrapper.find('.cps-banner--warning').exists()).toBe(false);
    });
});

describe('point-A review: the backend address (security F1)', () => {
    const EVIL = 'https://evil.example';
    const problemJson = (slug: string, status: number) =>
        new Response(JSON.stringify({ type: `https://x.example/problems.md#${slug}`, title: slug, status }), { status, headers: { 'Content-Type': 'application/problem+json' } });

    it('settings reloaded with another backendUrl: nothing (no token, no ChurchTools password) goes to the new address', async () => {
        const requests: { url: string; authorization?: string; body?: string }[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init: RequestInit) => {
                requests.push({ url, authorization: (init.headers as Record<string, string>).Authorization, body: init.body as string | undefined });
                if (init.method === 'GET') return problemJson('entry-not-found', 404);
                if (String(init.body).includes('secondaryPwd')) return problemJson('custom-password-not-allowed', 400);
                return new Response(JSON.stringify({ secondaryPwd: 'Gen3rated!pass12' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }),
        );
        try {
            const { wrapper, stored, settings } = await start({ realBackend: true, requirePrimary: true });
            await click(wrapper, TEXT.setPassword);
            await primaryInput(wrapper).setValue(CT_PASSWORD);
            await chooseCustom(wrapper, VALID);
            // Another admin points the settings at another backend meanwhile; the page reloads them.
            stored.value = JSON.stringify({ ...settings, revision: 2, backendUrl: EVIL });
            await click(wrapper, TEXT.submitCustom);
            await wrapper.find('input[type="radio"][value="generate"]').setValue(true);
            await click(wrapper, TEXT.submitGenerate);
            expect(requests.filter((r) => r.body?.includes(CT_PASSWORD))).toHaveLength(2);
            expect(requests.every((r) => r.url.startsWith(`${BACKEND}/v1/`))).toBe(true);
            expect(requests.some((r) => r.url.startsWith(EVIL))).toBe(false);
            expect(resultInput(wrapper).element.value).toBe('Gen3rated!pass12');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('the result field is not offered to password managers for filling (autocomplete off)', async () => {
        const { wrapper } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        expect(resultInput(wrapper).attributes('autocomplete')).toBe('off');
    });

    it('unmounted during a pending direct-path PUT: the late plaintext appears nowhere', async () => {
        const { wrapper, holdPuts, fakeBackend, storage } = await start({ allowCustom: false, requirePrimary: false });
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const release = holdPuts();
        await click(wrapper, TEXT.setPassword);
        mounted.splice(mounted.indexOf(wrapper), 1);
        wrapper.unmount();
        release();
        await settle();
        const password = fakeBackend.entries.get(ME)!;
        expect(password).toBeDefined();
        expect(document.body.innerHTML).not.toContain(password);
        expect([...storage.map.values()].join('|')).not.toContain(password);
        expect(setItem.mock.calls.flat().join('|')).not.toContain(password);
    });
});

describe('point-A review: renewal inside the click handler (I1)', () => {
    it('„Passwort festlegen“: ensureFresh and the popup run before the handler awaits anything', async () => {
        const { wrapper, session, clock, open } = await start();
        const fresh = vi.spyOn(session, 'ensureFresh');
        clock.now += 540_000;
        clickNow(wrapper, TEXT.setPassword);
        expect(fresh).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledTimes(1);
        await settle();
    });

    it('submit: ensureFresh and the popup run before the handler awaits anything', async () => {
        const { wrapper, session, clock, open } = await start();
        await click(wrapper, TEXT.setPassword);
        const fresh = vi.spyOn(session, 'ensureFresh');
        clock.now += 540_000;
        open.mockClear();
        clickNow(wrapper, TEXT.submitGenerate);
        expect(fresh).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledTimes(1);
        await settle();
    });
});

describe('point-A review: typed input counts as unsaved (I2)', () => {
    async function invalidToken(s: Awaited<ReturnType<typeof start>>) {
        s.fakeBackend.failNext('invalid-token', 401);
        void s.session.call(() => s.fakeBackend.getEntry(ME)).catch(() => undefined);
        await settle();
    }

    it('only a typed custom password: no redirect, the banner, the input kept', async () => {
        const s = await start();
        await click(s.wrapper, TEXT.setPassword);
        await chooseCustom(s.wrapper, VALID);
        await invalidToken(s);
        expect(s.assigned).toEqual([]);
        expect(s.wrapper.text()).toContain(TEXT.sessionExpired);
        expect(customInput(s.wrapper).element.value).toBe(VALID);
    });

    it('only a typed ChurchTools password: no redirect, the banner, the input kept', async () => {
        const s = await start({ requirePrimary: true });
        await click(s.wrapper, TEXT.setPassword);
        await primaryInput(s.wrapper).setValue(CT_PASSWORD);
        await invalidToken(s);
        expect(s.assigned).toEqual([]);
        expect(s.wrapper.text()).toContain(TEXT.sessionExpired);
        expect(primaryInput(s.wrapper).element.value).toBe(CT_PASSWORD);
    });

    it('the form open with nothing typed: a full login starts', async () => {
        const s = await start({ requirePrimary: true });
        await click(s.wrapper, TEXT.setPassword);
        await invalidToken(s);
        expect(s.assigned).toHaveLength(1);
    });
});

describe('point-A review: failures before and after sending (I3, I5)', () => {
    it('the renewal before sending fails with an unreachable backend: its text, no unknown outcome, no PUT', async () => {
        const { wrapper, auth, clock, calls } = await start();
        await click(wrapper, TEXT.setPassword);
        vi.spyOn(auth, 'loginInPopup').mockRejectedValue(new BackendUnreachable());
        clock.now += 540_000;
        await click(wrapper, TEXT.submitGenerate);
        expect(errorAbove(wrapper).text()).toBe('Der Dienst ist gerade nicht erreichbar. Versuch es gleich noch einmal.');
        expect(wrapper.text()).not.toContain(TEXT.unknown);
        expect(calls.put).toBe(0);
    });

    it('left during a PUT that times out after writing: the reopened page shows „Passwort ist gesetzt“ without a click', async () => {
        const { wrapper, router, holdPuts, fakeBackend } = await start({ allowCustom: false, requirePrimary: false });
        const release = holdPuts();
        await click(wrapper, TEXT.setPassword);
        await router.push('/about');
        await settle();
        await router.push('/');
        await settle();
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.none);
        // The held PUT reaches the backend now, which stores and then times out.
        fakeBackend.breakNext('unreachable', { afterWrite: true });
        release();
        await settle();
        expect(wrapper.find('.cps-pill').text()).toBe(TEXT.isSet);
    });

    it('state 1 near expiry with the popup blocked: the banner, no error, the form stays closed, nothing requested', async () => {
        const { wrapper, clock, calls } = await start();
        const gets = calls.get;
        clock.now += 540_000;
        await click(wrapper, TEXT.setPassword);
        expect(wrapper.text()).toContain(TEXT.sessionExpired);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(button(wrapper, TEXT.submitGenerate)).toBeUndefined();
        expect(calls.get).toBe(gets);
        expect(calls.put).toBe(0);
    });

    it('state 1: a renewal failing otherwise shows its text above the button; the form stays closed', async () => {
        const { wrapper, auth, clock } = await start();
        vi.spyOn(auth, 'loginInPopup').mockRejectedValue(new BackendUnreachable());
        clock.now += 540_000;
        await click(wrapper, TEXT.setPassword);
        const error = wrapper.find('.cps-password__error');
        expect(error.attributes('role')).toBe('alert');
        expect(error.text()).toBe('Der Dienst ist gerade nicht erreichbar. Versuch es gleich noch einmal.');
        expect(button(wrapper, TEXT.submitGenerate)).toBeUndefined();
    });
});

describe('point-A review: details only for admins and settings editors (I4)', () => {
    const DETAIL = '<b>BACKEND_KEY</b> missing';

    it('a settings editor who is no admin sees „Details“ on a load error', async () => {
        const { wrapper } = await startFailingGet('misconfigured', 500, DETAIL, { perms: EDITOR });
        expect(wrapper.find('main details').text()).toContain(DETAIL);
    });

    async function submitFailing(o: Options) {
        const s = await start(o);
        await click(s.wrapper, TEXT.setPassword);
        s.fakeBackend.failNext('misconfigured', 500, { detail: DETAIL });
        await click(s.wrapper, TEXT.submitGenerate);
        return s;
    }

    it('a user gets no details for a failed submit', async () => {
        const { wrapper } = await submitFailing({});
        expect(errorAbove(wrapper).text()).toBe('Der Dienst ist noch nicht richtig eingerichtet.');
        expect(wrapper.find('details').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('BACKEND_KEY');
    });

    it.each([
        ['an admin', { admin: true }],
        ['a settings editor', { perms: EDITOR }],
    ])('%s gets the detail of a failed submit as plain text', async (_who, o) => {
        const { wrapper } = await submitFailing(o);
        expect(errorAbove(wrapper).find('details').text()).toContain(DETAIL);
        expect(errorAbove(wrapper).find('b').exists()).toBe(false);
    });
});

describe('point-A review: „✓ Gespeichert“ only right after saving a chosen password (I6)', () => {
    it('not after „Abbrechen“', async () => {
        const { wrapper } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.cancel);
        expect(wrapper.find('.cps-password__saved').exists()).toBe(false);
    });

    it('not after „Fertig“', async () => {
        const { wrapper } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        await click(wrapper, TEXT.done);
        expect(wrapper.find('.cps-password__saved').exists()).toBe(false);
    });

    it('gone when the form is opened again and cancelled', async () => {
        const { wrapper } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        await click(wrapper, TEXT.submitCustom);
        expect(wrapper.find('.cps-password__saved').exists()).toBe(true);
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.cancel);
        expect(wrapper.find('.cps-password__saved').exists()).toBe(false);
    });

    it('gone on the next click even when the form cannot open (blocked popup)', async () => {
        const { wrapper, clock } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        await click(wrapper, TEXT.submitCustom);
        clock.now += 540_000;
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-password__saved').exists()).toBe(false);
    });
});

describe('point-A review: smaller cases (M1 to M11)', () => {
    it('a double click sends once; the submit button is disabled while sending', async () => {
        const { wrapper, holdPuts, calls } = await start();
        await click(wrapper, TEXT.setPassword);
        const release = holdPuts();
        clickNow(wrapper, TEXT.submitGenerate);
        clickNow(wrapper, TEXT.submitGenerate);
        await settle();
        expect(button(wrapper, TEXT.submitGenerate)!.attributes('disabled')).toBeDefined();
        release();
        await settle();
        expect(calls.put).toBe(1);
    });

    it('custom passwords off and on again: the custom field starts empty', async () => {
        const { wrapper, fakeBackend, stored, settings } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        stored.value = JSON.stringify({ ...settings, revision: 2, allowCustomPassword: false });
        fakeBackend.setSettings({ allowCustomPassword: false });
        await click(wrapper, TEXT.submitCustom);
        stored.value = JSON.stringify({ ...settings, revision: 3, allowCustomPassword: true });
        fakeBackend.failNext('custom-password-not-allowed', 400);
        await click(wrapper, TEXT.submitGenerate);
        await wrapper.find('input[type="radio"][value="custom"]').setValue(true);
        expect(customInput(wrapper).element.value).toBe('');
    });

    it('a session problem while the renewal banner is up adds no error above the button', async () => {
        const { wrapper, fakeBackend } = await start();
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, VALID);
        fakeBackend.failNext('invalid-token', 401);
        await click(wrapper, TEXT.submitCustom);
        expect(wrapper.text()).toContain(TEXT.sessionExpired);
        expect(errorAbove(wrapper).exists()).toBe(false);
        expect(customInput(wrapper).element.value).toBe(VALID);
    });

    it('primary-password-required shows at the ChurchTools field', async () => {
        const { wrapper, fakeBackend } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await primaryInput(wrapper).setValue(CT_PASSWORD);
        fakeBackend.failNext('primary-password-required', 400);
        await click(wrapper, TEXT.submitGenerate);
        expect(wrapper.find(`#${primaryInput(wrapper).attributes('aria-describedby')}`).text()).toBe(TEXT.primaryMissing);
        expect(errorAbove(wrapper).exists()).toBe(false);
    });

    it.each([
        ['the unknown-outcome warning', (f: ReturnType<typeof createFakeBackend>) => f.breakNext('unreachable', { afterWrite: true }), TEXT.unknown],
        ['the error above the button', (f: ReturnType<typeof createFakeBackend>) => f.failNext('forbidden', 403), 'Dafür hast du keine Berechtigung.'],
        ['the error at the ChurchTools field', (f: ReturnType<typeof createFakeBackend>) => f.failNext('invalid-primary-password', 403), TEXT.primaryWrong],
    ])('%s goes away when the form is sent again', async (_name, arm, text) => {
        const { wrapper, fakeBackend, holdPuts } = await start({ requirePrimary: true });
        await click(wrapper, TEXT.setPassword);
        await primaryInput(wrapper).setValue(CT_PASSWORD);
        arm(fakeBackend);
        await click(wrapper, TEXT.submitGenerate);
        expect(wrapper.text()).toContain(text);
        const release = holdPuts();
        await click(wrapper, TEXT.submitGenerate);
        expect(wrapper.text()).not.toContain(text);
        release();
        await settle();
    });

    it('revealed: a no-break space and a combining mark are named as U+XXXX', async () => {
        const { wrapper } = await start({ passwordLength: 14 });
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, 'Abcdefgh12345! é');
        await wrapper.find('button[aria-label="Passwort anzeigen"]').trigger('click');
        const named = wrapper.find('.cps-rules__named').text();
        expect(named).toContain('U+00A0');
        expect(named).toContain('U+0301');
    });

    it('masked: the first characters outside ASCII (U+00A1) and ASCII symbols not in the list (~) are told apart', async () => {
        const { wrapper } = await start({ passwordLength: 14 });
        await click(wrapper, TEXT.setPassword);
        await chooseCustom(wrapper, 'Abcdefgh12345!¡');
        expect(wrapper.find('.cps-rules__named').text()).toBe('Nicht erlaubt: Umlaute und Zeichen außerhalb von ASCII');
        await customInput(wrapper).setValue('Abcdefgh12345!~');
        expect(wrapper.find('.cps-rules__named').text()).toBe('Nicht erlaubt: Sonderzeichen, die nicht in der Liste stehen');
    });

    it.each([
        ['generated', async (w: VueWrapper) => click(w, TEXT.submitGenerate)],
        [
            'chosen',
            async (w: VueWrapper) => {
                await chooseCustom(w, VALID);
                await click(w, TEXT.submitCustom);
            },
        ],
    ])('no ChurchTools password in the body when it is not required (%s)', async (_name, send) => {
        const { wrapper, puts } = await start({ requirePrimary: false });
        await click(wrapper, TEXT.setPassword);
        await send(wrapper);
        expect(puts).toHaveLength(1);
        expect(Object.keys(puts[0]!)).not.toContain('primaryPwd');
    });

    it('a failed copy says so in state 3', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        try {
            const { wrapper } = await start();
            await click(wrapper, TEXT.setPassword);
            await click(wrapper, TEXT.submitGenerate);
            await wrapper.find('.cps-flow__result button[aria-label="Kopieren"]').trigger('click');
            await settle();
            expect(wrapper.find('.cps-flow__result [role="alert"]').text()).toBe('Kopieren hat nicht geklappt. Markier das Passwort und kopier es selbst.');
        } finally {
            if (original) Object.defineProperty(navigator, 'clipboard', original);
            else delete (navigator as { clipboard?: unknown }).clipboard;
        }
    });

    it('the plaintext is not in the app’s session storage either', async () => {
        const { wrapper, fakeBackend, storage } = await start();
        await click(wrapper, TEXT.setPassword);
        await click(wrapper, TEXT.submitGenerate);
        const password = fakeBackend.entries.get(ME)!;
        expect([...storage.map.values()].join('|')).not.toContain(password);
    });
});
