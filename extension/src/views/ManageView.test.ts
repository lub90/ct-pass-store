/**
 * App layer (mounted): „Passwörter verwalten“ (spec 4.3) as an admin sees it, with the real `Auth`, session and store
 * over the fake ChurchTools and the fake backend. Only the browser (storage, popup, clock) is faked.
 */
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createMemoryHistory, type Router } from 'vue-router';
import App from '../App.vue';
import type { AppState } from '../app/app-state';
import { SERVICES_KEY, type Services } from '../app/services';
import { APP_STATE_KEY, type AppStateHandle } from '../app/useAppState';
import { SESSION_KEY, createSession } from '../app/useSession';
import type { BackendApi } from '../backend/api';
import { Auth, CALLBACK_WINDOW_KEY, TOKEN_KEY, type AuthEnv, type CallbackWindow } from '../backend/auth';
import { backendBase } from '../backend/http';
import { BackendProblem, BackendUnreachable } from '../backend/problems';
import type { CtApi } from '../ct/api';
import type { Permissions } from '../ct/types';
import { createFakeBackend } from '../dev/fake-backend';
import { createFakeChurchTools } from '../dev/fake-churchtools';
import { createAppI18n } from '../i18n';
import type { SettingsV2 } from '../model/schemas';
import { createAppRouter } from '../router';
import { ChurchToolsKv } from '../store/churchtools-kv';
import { ExtensionStore } from '../store/repository';
import { answerConfirm, pendingConfirm } from '../ui/useConfirm';
import ManageView from './ManageView.vue';

const ORIGIN = 'https://ct.example';
const BACKEND = 'https://pw.example';
const NOW = 1_800_000_000_000;
const ME = 1;
const MUELLER = 2;
const MULDE = 3;
const ODD = 4;
const OUTSIDER = 5;
/** Two members with the same name. */
const TWIN_A = 6;
const TWIN_B = 7;
/** A name with a right-to-left override (U+202E). */
const BIDI = 8;
const BIDI_LAST = '\u202Enamffoh';
/** A name that tries to close the isolate around it (U+2069) and override the rest of the sentence (U+202E). */
const ESCAPE = 9;
const ESCAPE_LAST = 'Beck\u2069\u202E';
const USERS_GROUP = 40;
const ADMINS_GROUP = 41;
const SETTINGS_ID = 11;
const ACCESS_ID = 12;
const CT_PASSWORD = 'admin-ct-password';
const VALID = 'Abcdefgh1234!xyz';
/** A ChurchTools name that would be message syntax or HTML if it were ever compiled. */
const ODD_NAME = '{x} @:app.name | <b>y</b>';

const TEXT = {
    title: 'Passwörter verwalten',
    intro: 'Setz oder lösch das Passwort einer anderen Person, z. B. wenn sie ihres vergessen hat.',
    isSet: '✓ Passwort ist gesetzt',
    none: 'Noch kein Passwort',
    newPassword: 'Neues Passwort',
    delete: 'Löschen',
    cancel: 'Abbrechen',
    generate: 'Passwort erzeugen',
    submitCustom: 'Passwort speichern',
    saved: '✓ Gespeichert',
    deleted: '✓ Gelöscht',
    done: 'Fertig',
    proceed: 'Fortfahren',
    primaryLabel: 'Dein ChurchTools-Passwort (zur Bestätigung)',
    forName: (name: string) => `Du legst gerade das Passwort für ${name} fest.`,
    /** Names in dialog texts are isolated: U+2068 … U+2069. */
    replaceText: (name: string) => `Das bisherige Passwort von \u2068${name}\u2069 funktioniert danach nicht mehr. Fortfahren?`,
    deleteText: (name: string) => `Das Passwort von \u2068${name}\u2069 wird gelöscht und funktioniert danach nicht mehr.`,
    notInGroup: 'Diese Person ist nicht in der Nutzergruppe. Such eine Person über das Suchfeld.',
    missingGroupRight: 'Dir fehlt in ChurchTools das Recht „view group“ auf die Nutzergruppe. Ohne dieses Recht kannst du hier niemanden suchen.',
    personNotFound: 'Diese Person gibt es in ChurchTools nicht mehr.',
    primaryWrong: 'Das ChurchTools-Passwort stimmt nicht.',
    noHits: 'Niemand in der Nutzergruppe passt zu dieser Suche.',
    pick: 'Such eine Person, um ihr Passwort festzulegen oder zu löschen.',
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
    allowCustom?: boolean;
    requirePrimary?: boolean;
    entries?: Record<number, string>;
    admin?: boolean;
    /** Groups the admin has „view group“ on; default the users group. */
    viewGroups?: number[];
    /** Whether the admin is a member of the users group (default yes). */
    meInUsers?: boolean;
    path?: string;
    tokenLeftMs?: number;
    /** Two „Anna Müller“ in the users group as well. */
    twins?: boolean;
    /** What `access` holds; `null`: nothing stored. */
    access?: unknown;
    perms?: Partial<Permissions>;
}

const ACCESS = {
    schema: 2,
    revision: 1,
    groups: {
        users: { groupId: USERS_GROUP, createdBySetup: true },
        admins: { groupId: ADMINS_GROUP, createdBySetup: true },
        service: { groupId: 42, createdBySetup: true },
    },
    machineClients: [],
};

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
    'view custom data': [SETTINGS_ID, ACCESS_ID],
    'create custom data': [],
    'edit custom data': [],
    'delete custom data': [],
    ...p,
});

function settingsOf(o: Options) {
    return {
        schema: 2,
        revision: 1,
        requirePasswordForPasswordChange: o.requirePrimary ?? false,
        allowCustomPassword: o.allowCustom ?? true,
        passwordLength: 16,
        backendUrl: BACKEND,
        oauthClientId: 'oauth-client-1',
    };
}

function fakes(o: Options) {
    const settings = settingsOf(o);
    const fakeCt = createFakeChurchTools({
        moduleKey: 'ctpassstore',
        moduleId: 7,
        currentPersonId: ME,
        persons: [
            { id: ME, firstName: 'Anna', lastName: 'Admin' },
            { id: MUELLER, firstName: 'Jürgen', lastName: 'Müller' },
            { id: MULDE, firstName: 'Bernd', lastName: 'Mulde' },
            { id: ODD, firstName: 'Eva', lastName: ODD_NAME },
            { id: OUTSIDER, firstName: 'Otto', lastName: 'Außen' },
            { id: TWIN_A, firstName: 'Anna', lastName: 'Müller' },
            { id: TWIN_B, firstName: 'Anna', lastName: 'Müller' },
            { id: BIDI, firstName: 'Rafa', lastName: BIDI_LAST },
            { id: ESCAPE, firstName: 'Ida', lastName: ESCAPE_LAST },
        ],
        groups: [
            { id: USERS_GROUP, name: 'CtPassStore Nutzer', memberIds: [...(o.meInUsers === false ? [] : [ME]), MUELLER, MULDE, ODD, BIDI, ESCAPE, ...(o.twins ? [TWIN_A, TWIN_B] : [])] },
            { id: ADMINS_GROUP, name: 'CtPassStore Admins', memberIds: [ME] },
            { id: 50, name: 'Other', memberIds: [OUTSIDER] },
        ],
        categories: [
            { id: SETTINGS_ID, name: 'settings', shorty: 'settings' },
            { id: ACCESS_ID, name: 'access', shorty: 'access' },
        ],
        values: [],
        permissions: perms(o.perms),
        viewGroupIds: o.viewGroups ?? [USERS_GROUP],
    });
    const access = o.access === undefined ? ACCESS : o.access;
    const counts = { members: 0, accessReads: 0 };
    const ct: CtApi = {
        ...fakeCt,
        values: async (moduleId, categoryId) => {
            await fakeCt.values(moduleId, categoryId);
            if (categoryId === SETTINGS_ID) return [{ id: 101, dataCategoryId: SETTINGS_ID, value: JSON.stringify(settings) }];
            if (categoryId === ACCESS_ID) {
                counts.accessReads++;
                return access === null ? [] : [{ id: 102, dataCategoryId: ACCESS_ID, value: JSON.stringify(access) }];
            }
            return [];
        },
        groupMembers: (id) => (counts.members++, fakeCt.groupMembers(id)),
    };
    const fakeBackend = createFakeBackend({
        personId: ME,
        admin: o.admin ?? true,
        existingPersonIds: [ME, MUELLER, MULDE, ODD, OUTSIDER, TWIN_A, TWIN_B, BIDI, ESCAPE],
        ctOrigin: ORIGIN,
        primaryPassword: CT_PASSWORD,
        requirePasswordForPasswordChange: settings.requirePasswordForPasswordChange,
        allowCustomPassword: settings.allowCustomPassword,
        passwordLength: settings.passwordLength,
        version: '0.1.0',
        entries: o.entries ?? {},
    });
    /** `hold`: status reads wait for it; `fail`: status reads fail (unreachable). */
    const gets: { hold: Promise<void> | null; fail: boolean } = { hold: null, fail: false };
    /** `hold`: deletes wait for it. */
    const dels: { hold: Promise<void> | null } = { hold: null };
    const calls = { get: [] as number[], put: [] as { id: number; body: Record<string, unknown> }[], del: [] as { id: number; primaryPwd?: string }[] };
    const counted: BackendApi = {
        ...fakeBackend,
        getEntry: async (id) => {
            calls.get.push(id);
            if (gets.hold) await gets.hold;
            if (gets.fail) throw new BackendUnreachable();
            return fakeBackend.getEntry(id);
        },
        putEntry: (id, body) => (calls.put.push({ id, body: { ...body } }), fakeBackend.putEntry(id, body)),
        deleteEntry: async (id, primaryPwd) => {
            calls.del.push(primaryPwd === undefined ? { id } : { id, primaryPwd });
            if (dels.hold) await dels.hold;
            return fakeBackend.deleteEntry(id, primaryPwd);
        },
    };
    return { ct, fakeCt, fakeBackend, counted, calls, counts, settings, gets, dels };
}

function browser(o: Options) {
    const storage = new MemoryStorage();
    const clock = { now: NOW };
    const open = vi.fn<AuthEnv['open']>(() => null);
    const env: AuthEnv = {
        origin: ORIGIN,
        instanceBaseUrl: ORIGIN,
        redirectPath: '/ccm/ctpassstore/auth/callback',
        storage: () => storage,
        assign: () => undefined,
        open,
        listen: () => () => undefined,
        every: () => () => undefined,
        now: () => clock.now,
    };
    storage.setItem(
        TOKEN_KEY,
        JSON.stringify({ accessToken: jwt(ME), expiresAt: NOW + (o.tokenLeftMs ?? 600_000), admin: o.admin ?? true, version: '0.1.0', backend: backendBase(BACKEND), person: ME }),
    );
    return { storage, clock, open, env };
}

async function start(o: Options = {}) {
    const f = fakes(o);
    const b = browser(o);
    const router: Router = createAppRouter(createMemoryHistory());
    const auth = new Auth(() => f.counted, b.env);
    const session = createSession(auth, () => router.currentRoute.value.fullPath);
    const services: Services = {
        session,
        ct: f.ct,
        store: new ExtensionStore(new ChurchToolsKv(f.ct, 'ctpassstore')),
        auth,
        backend: () => f.counted,
        language: 'de',
        appVersion: '0.1.0',
    };
    const win: CallbackWindow = { opener: null, origin: ORIGIN, close: vi.fn() };
    await router.push(o.path ?? '/manage');
    const wrapper = mount(App, {
        attachTo: document.body,
        global: { plugins: [router, createAppI18n('de')], provide: { [SERVICES_KEY as symbol]: services, [CALLBACK_WINDOW_KEY as symbol]: win } },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, router, session, ...f, ...b };
}

async function settle() {
    for (let i = 0; i < 10; i++) {
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    }
}

const button = (w: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> | undefined => w.findAll('button').find((b) => b.text() === text);
function clickNow(w: VueWrapper, text: string) {
    const b = button(w, text);
    if (!b) throw new Error(`No button „${text}“ in: ${w.text()}`);
    b.element.click();
}
async function click(w: VueWrapper, text: string) {
    clickNow(w, text);
    await settle();
}

/** Types into the person search and waits for the debounce. */
async function search(w: VueWrapper, query: string) {
    await w.find('input[role="combobox"]').setValue(query);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();
}
const options = (w: VueWrapper) => w.findAll('[role="option"]').map((o) => o.find('.cps-picker__name').text());
async function pick(w: VueWrapper, query: string, name: string) {
    await search(w, query);
    const option = w.findAll('[role="option"]').find((o) => o.find('.cps-picker__name').text() === name);
    if (!option) throw new Error(`No option „${name}“ in: ${options(w).join(', ')}`);
    await option.trigger('click');
    await settle();
}

const dialog = () => document.querySelector<HTMLElement>('.cps-confirm__dialog');
const dialogText = () => dialog()?.querySelector('.cps-confirm__text')?.textContent?.trim();
const dialogInput = () => dialog()?.querySelector<HTMLInputElement>('input');
async function answer(label: string) {
    const b = [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((x) => x.textContent?.trim() === label);
    if (!b) throw new Error(`No dialog button „${label}“`);
    b.click();
    await settle();
}
async function typeInDialog(value: string) {
    const input = dialogInput()!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
}
const card = (w: VueWrapper) => w.find('.cps-manage__person');
/** A promise and its resolver, for a renewal (or request) that takes its time. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
}
const SESSION_BANNER = 'Deine Sitzung ist abgelaufen.';
const pill = (w: VueWrapper) => card(w).find('.cps-pill');

describe('page head and search (spec 4.3)', () => {
    it('shows the header and an empty state', async () => {
        const { wrapper } = await start();
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(wrapper.text()).toContain(TEXT.intro);
        expect(wrapper.find('main .cps-status--empty').text()).toBe(TEXT.pick);
        expect(wrapper.find('input[role="combobox"]').exists()).toBe(true);
    });

    it('finds „Müller“ for „mul“ and for „Mül“', async () => {
        const { wrapper } = await start();
        await search(wrapper, 'mul');
        expect(options(wrapper)).toEqual(['Bernd Mulde', 'Jürgen Müller']);
        await search(wrapper, 'Mül');
        expect(options(wrapper)).toContain('Jürgen Müller');
    });

    it('offers only members of the users group', async () => {
        const { wrapper } = await start();
        await search(wrapper, 'otto');
        expect(options(wrapper)).toEqual([]);
        expect(wrapper.text()).toContain(TEXT.noHits);
        await search(wrapper, 'a');
        expect(options(wrapper)).not.toContain('Otto Außen');
    });

    it('loads the members once per page visit, not per search or selection', async () => {
        const { wrapper, counts, router } = await start();
        expect(counts.members).toBe(1);
        // Startup reads `access` too; the page reads it once more, and not again per search or selection.
        const accessReads = counts.accessReads;
        await search(wrapper, 'mu');
        await search(wrapper, 'be');
        await pick(wrapper, 'mül', 'Jürgen Müller');
        await pick(wrapper, 'bernd', 'Bernd Mulde');
        expect(counts.members).toBe(1);
        expect(counts.accessReads).toBe(accessReads);
        // Another visit loads them again.
        await router.push('/');
        await settle();
        await router.push('/manage');
        await settle();
        expect(counts.members).toBe(2);
    });

    it('selecting puts the person in the address; a reload restores the selection', async () => {
        const { wrapper, router } = await start({ entries: { [MUELLER]: VALID } });
        await pick(wrapper, 'mül', 'Jürgen Müller');
        expect(router.currentRoute.value.path).toBe(`/manage/${MUELLER}`);
        expect(card(wrapper).text()).toContain('Jürgen Müller');
        expect(pill(wrapper).text()).toBe(TEXT.isSet);

        const reloaded = await start({ entries: { [MUELLER]: VALID }, path: `/manage/${MUELLER}` });
        expect(card(reloaded.wrapper).text()).toContain('Jürgen Müller');
        expect(pill(reloaded.wrapper).text()).toBe(TEXT.isSet);
        expect((reloaded.wrapper.find('input[role="combobox"]').element as HTMLInputElement).value).toBe('Jürgen Müller');
        expect(reloaded.calls.get).toEqual([MUELLER]);
    });

    it('a person without an entry: „Noch kein Passwort“, no „Löschen“', async () => {
        const { wrapper } = await start({ path: `/manage/${MULDE}` });
        expect(pill(wrapper).text()).toBe(TEXT.none);
        expect(button(wrapper, TEXT.newPassword)).toBeDefined();
        expect(button(wrapper, TEXT.delete)).toBeUndefined();
    });

    it('shows the avatar and the name of the selected person', async () => {
        const { wrapper } = await start({ path: `/manage/${MUELLER}` });
        expect(card(wrapper).find('.cps-manage__avatar').text()).toBe('JM');
        expect(card(wrapper).find('.cps-manage__avatar').attributes('aria-hidden')).toBe('true');
    });

    it('the avatar skips invisible format characters (a bidi control is never an initial)', async () => {
        // „Rafa ‮namffoh“: the last word starts with U+202E; its first letter is „n“.
        const { wrapper } = await start({ path: `/manage/${BIDI}` });
        expect(card(wrapper).find('.cps-manage__avatar').text()).toBe('RN');
    });

    it('clearing the search drops the selection: back to /manage and the empty state', async () => {
        const { wrapper, router } = await start({ path: `/manage/${MUELLER}` });
        await wrapper.find('input[role="combobox"]').setValue('');
        await settle();
        expect(router.currentRoute.value.path).toBe('/manage');
        expect(card(wrapper).exists()).toBe(false);
        expect(wrapper.find('main .cps-status--empty').text()).toBe(TEXT.pick);
    });

    it('selecting replaces the address instead of adding a history entry', async () => {
        const { wrapper, router } = await start();
        const push = vi.spyOn(router, 'push');
        const replace = vi.spyOn(router, 'replace');
        await pick(wrapper, 'mül', 'Jürgen Müller');
        expect(replace).toHaveBeenCalledWith(`/manage/${MUELLER}`);
        expect(push).not.toHaveBeenCalled();
    });

    it('the picker is hidden while the flow is open', async () => {
        const { wrapper } = await start({ path: `/manage/${MUELLER}` });
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-flow').exists()).toBe(true);
        expect(wrapper.find('input[role="combobox"]').exists()).toBe(false);
        await click(wrapper, TEXT.cancel);
        expect(wrapper.find('input[role="combobox"]').exists()).toBe(true);
    });

    it('a failed status read can be retried', async () => {
        const { wrapper, gets } = await start({ path: '/manage' });
        gets.fail = true;
        await pick(wrapper, 'bernd', 'Bernd Mulde');
        expect(card(wrapper).find('[role="alert"]').exists()).toBe(true);
        gets.fail = false;
        await click(wrapper, 'Erneut versuchen');
        expect(pill(wrapper).text()).toBe(TEXT.none);
    });
});

describe('a person from the address only', () => {
    it.each([`/manage/${OUTSIDER}`, '/manage/999'])('%s (not in the users group): a notice, no request', async (path) => {
        const { wrapper, calls } = await start({ path, entries: { [OUTSIDER]: VALID } });
        expect(wrapper.text()).toContain(TEXT.notInGroup);
        expect(calls.get).toEqual([]);
        expect(card(wrapper).exists()).toBe(false);
        expect(button(wrapper, TEXT.newPassword)).toBeUndefined();
        expect(button(wrapper, TEXT.delete)).toBeUndefined();
    });

    it.each(['/manage/abc', '/manage/05', '/manage/0', '/manage/-2', '/manage/1e1', '/manage/99999999999999999999'])(
        '%s (not a person id): the same notice, no request',
        async (path) => {
            const { wrapper, calls } = await start({ path });
            expect(wrapper.text()).toContain(TEXT.notInGroup);
            expect(calls.get).toEqual([]);
            expect(card(wrapper).exists()).toBe(false);
        },
    );

    it('changing the address to another member follows it; to an outsider drops the selection', async () => {
        const { wrapper, router, calls } = await start({ path: `/manage/${MUELLER}` });
        await router.push(`/manage/${MULDE}`);
        await settle();
        expect(card(wrapper).text()).toContain('Bernd Mulde');
        await router.push(`/manage/${OUTSIDER}`);
        await settle();
        expect(card(wrapper).exists()).toBe(false);
        expect(calls.get).toEqual([MUELLER, MULDE]);
    });
});

describe('rights', () => {
    it('without „view group“ on the users group: a banner naming the right, no picker, no entry read', async () => {
        const { wrapper, calls } = await start({ viewGroups: [], meInUsers: false, path: `/manage/${MUELLER}` });
        const banner = wrapper.find('main .cps-banner--warning');
        expect(banner.text()).toBe(TEXT.missingGroupRight);
        expect(wrapper.find('input[role="combobox"]').exists()).toBe(false);
        expect(calls.get).toEqual([]);
    });

    it('without „view custom data“ on access: a banner naming that right', async () => {
        const { wrapper, counts } = await start({ perms: { 'view custom data': [SETTINGS_ID] } });
        expect(wrapper.find('main .cps-banner--warning').text()).toContain('„view custom data“');
        expect(wrapper.find('main .cps-banner--warning').text()).toContain('„access“');
        expect(counts.members).toBe(0);
    });

    it('without a readable access value: says the users group is unknown, names the category right', async () => {
        const { wrapper, counts } = await start({ access: null });
        const text = wrapper.find('main .cps-banner--warning').text();
        expect(text).toContain('„view custom category“');
        expect(counts.members).toBe(0);
    });

    it('an invalid access value: points to „Zugriff“', async () => {
        const { wrapper, counts } = await start({ access: { schema: 2, revision: 1, groups: {} } });
        expect(wrapper.find('main .cps-banner--warning').text()).toContain('„Zugriff“');
        expect(counts.members).toBe(0);
    });

    it('ChurchTools slowing down while loading the members: the minutes, and a retry', async () => {
        const s = await start({ path: '/about' });
        s.fakeCt.failNext(429);
        await s.router.push('/manage');
        await settle();
        // The fake answers the first request (the access read) with 429.
        expect(s.wrapper.text()).toContain('ChurchTools bremst gerade. Versuch es in einer Minute noch einmal.');
        await click(s.wrapper, 'Erneut versuchen');
        expect(s.wrapper.find('input[role="combobox"]').exists()).toBe(true);
    });

    it('a plain user loads nothing on /manage (members, access, entries)', async () => {
        const { counts, calls } = await start({ admin: false, path: `/manage/${MUELLER}` });
        expect(counts.members).toBe(0);
        expect(calls.get).toEqual([]);
    });

    it('logged out of ChurchTools while loading the members: its own text, not „antwortet nicht“', async () => {
        const s = await start({ path: '/about' });
        s.fakeCt.failNext(401);
        await s.router.push('/manage');
        await settle();
        expect(s.wrapper.text()).toContain('Du bist in ChurchTools nicht mehr angemeldet. Lade die Seite neu.');
        expect(s.wrapper.text()).not.toContain('ChurchTools antwortet gerade nicht');
    });
});

describe('the page checks its own right, on top of the frame', () => {
    async function mountAlone(state: AppState, o: Options = {}) {
        const f = fakes(o);
        const b = browser(o);
        const router = createAppRouter(createMemoryHistory());
        await router.push(`/manage/${MUELLER}`);
        const auth = new Auth(() => f.counted, b.env);
        // What startup does before any page shows (useAppState step 3).
        auth.configure({ backendUrl: BACKEND, clientId: 'oauth-client-1' });
        auth.bindPerson(ME);
        const session = createSession(auth, () => router.currentRoute.value.fullPath);
        const stateRef = ref<AppState>(state);
        const app = {
            state: computed(() => stateRef.value),
            settings: ref(f.settings as unknown as SettingsV2),
            personId: ref(ME),
            settingsEditor: ref({ settings: false, access: false }),
            reloadSettings: async () => undefined,
        } as unknown as AppStateHandle;
        const services: Services = { session, ct: f.ct, store: new ExtensionStore(new ChurchToolsKv(f.ct, 'ctpassstore')), auth, backend: () => f.counted, language: 'de' };
        const wrapper = mount(ManageView, {
            attachTo: document.body,
            global: {
                plugins: [router, createAppI18n('de')],
                provide: { [SERVICES_KEY as symbol]: services, [SESSION_KEY as symbol]: session, [APP_STATE_KEY as symbol]: app },
            },
        });
        mounted.push(wrapper);
        await settle();
        return { wrapper, stateRef, ...f };
    }

    it.each<AppState>(['user', 'backend-error', 'loading'])('in state %s: a banner, no ChurchTools or backend request', async (state) => {
        const { wrapper, counts, calls } = await mountAlone(state);
        expect(wrapper.find('.cps-banner--warning').text()).toBe('Diese Seite ist nur für Admins.');
        expect(counts.members).toBe(0);
        expect(counts.accessReads).toBe(0);
        expect(calls.get).toEqual([]);
    });

    it('a delete confirmed after the page unmounted sends nothing, even with the address unchanged', async () => {
        const { wrapper, calls, fakeBackend } = await mountAlone('admin', { entries: { [MUELLER]: VALID } });
        clickNow(wrapper as unknown as VueWrapper, TEXT.delete);
        await settle();
        expect(pendingConfirm.value?.text).toBe(TEXT.deleteText('Jürgen Müller'));
        wrapper.unmount();
        mounted.splice(mounted.indexOf(wrapper as unknown as VueWrapper), 1);
        answerConfirm({ confirmed: true });
        await settle();
        expect(calls.del).toEqual([]);
        expect(fakeBackend.entries.get(MUELLER)).toBe(VALID);
    });

    it('loads once the state becomes admin', async () => {
        const { wrapper, stateRef, counts, calls } = await mountAlone('loading');
        stateRef.value = 'admin';
        await settle();
        expect(counts.members).toBe(1);
        expect(calls.get).toEqual([MUELLER]);
        expect(card(wrapper).text()).toContain('Jürgen Müller');
    });

    it('loads the members once per visit, also when the state goes away and comes back', async () => {
        const { stateRef, counts } = await mountAlone('admin');
        expect(counts.members).toBe(1);
        stateRef.value = 'loading';
        await settle();
        stateRef.value = 'admin';
        await settle();
        expect(counts.members).toBe(1);
    });

    it('the entry stays gated on the admin state after the first load', async () => {
        const { wrapper, stateRef, calls } = await mountAlone('admin');
        expect(calls.get).toEqual([MUELLER]);
        stateRef.value = 'user';
        await settle();
        expect(wrapper.find('.cps-banner--warning').text()).toBe('Diese Seite ist nur für Admins.');
        const router = wrapper.vm.$router;
        await router.push(`/manage/${MULDE}`);
        await settle();
        expect(calls.get).toEqual([MUELLER]);
    });
});

describe('„Neues Passwort“ for another person', () => {
    it('shows the warning banner with the name above the flow', async () => {
        const { wrapper } = await start({ path: `/manage/${MUELLER}` });
        await click(wrapper, TEXT.newPassword);
        const banner = wrapper.find('.cps-flow-for');
        expect(banner.text()).toBe(TEXT.forName('Jürgen Müller'));
        expect(banner.find('strong').text()).toBe('Jürgen Müller');
        // Above the flow.
        const html = wrapper.html();
        expect(html.indexOf('cps-flow-for')).toBeLessThan(html.indexOf(TEXT.generate));
    });

    it('the banner takes its text from the app’s messages without an i18n scope warning', async () => {
        const warn = vi.spyOn(console, 'warn');
        try {
            const { wrapper } = await start({ path: `/manage/${MUELLER}` });
            await click(wrapper, TEXT.newPassword);
            expect(wrapper.find('.cps-flow-for').text()).toBe(TEXT.forName('Jürgen Müller'));
            expect(warn.mock.calls.flat().join('\n')).not.toContain('[intlify]');
        } finally {
            warn.mockRestore();
        }
    });

    it('without an entry: sends without a dialog and shows the generated password', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MULDE}` });
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.generate);
        expect(dialog()).toBeNull();
        expect(calls.put).toHaveLength(1);
        expect(calls.put[0]!.id).toBe(MULDE);
        expect(wrapper.find('.cps-flow__result input').exists()).toBe(true);
    });

    it('with an entry: a confirm dialog naming the person comes before sending', async () => {
        const { wrapper, calls, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.generate);
        expect(dialogText()).toBe(TEXT.replaceText('Jürgen Müller'));
        expect(calls.put).toEqual([]);
        await answer(TEXT.proceed);
        expect(calls.put).toHaveLength(1);
        expect(fakeBackend.entries.get(MUELLER)).not.toBe(VALID);
        const shown = (wrapper.find('.cps-flow__result input').element as HTMLInputElement).value;
        expect(shown).toBe(fakeBackend.entries.get(MUELLER));
    });

    it('with an entry: cancelling the dialog sends nothing and keeps the form with what was typed', async () => {
        const { wrapper, calls, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.newPassword);
        await wrapper.find('input[type="radio"][value="custom"]').setValue(true);
        await wrapper.find('input[autocomplete="new-password"]').setValue('Zyxwvuts9876!abc');
        await click(wrapper, TEXT.submitCustom);
        await answer(TEXT.cancel);
        expect(calls.put).toEqual([]);
        expect(fakeBackend.entries.get(MUELLER)).toBe(VALID);
        expect((wrapper.find('input[autocomplete="new-password"]').element as HTMLInputElement).value).toBe('Zyxwvuts9876!abc');
        expect(button(wrapper, TEXT.submitCustom)!.element.disabled).toBe(false);
    });

    it('the direct path with an entry asks first; cancelling goes back without sending', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, allowCustom: false, requirePrimary: false });
        await click(wrapper, TEXT.newPassword);
        expect(dialogText()).toBe(TEXT.replaceText('Jürgen Müller'));
        expect(calls.put).toEqual([]);
        await answer(TEXT.cancel);
        expect(calls.put).toEqual([]);
        expect(pill(wrapper).text()).toBe(TEXT.isSet);
        expect(button(wrapper, TEXT.newPassword)).toBeDefined();
    });

    it('leaving the page while the dialog is open: „Fortfahren“ then sends nothing (nobody would see the result)', async () => {
        const { wrapper, router, calls, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.generate);
        expect(dialog()).not.toBeNull();
        await router.push('/about');
        await settle();
        await answer(TEXT.proceed);
        expect(calls.put).toEqual([]);
        expect(fakeBackend.entries.get(MUELLER)).toBe(VALID);
    });

    it('the direct path with an entry sends after „Fortfahren“', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, allowCustom: false, requirePrimary: false });
        await click(wrapper, TEXT.newPassword);
        await answer(TEXT.proceed);
        expect(calls.put).toHaveLength(1);
        expect(wrapper.find('.cps-flow__result input').exists()).toBe(true);
    });

    it('asks for the admin’s own ChurchTools password and sends it', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MULDE}`, requirePrimary: true });
        await click(wrapper, TEXT.newPassword);
        const primary = wrapper.find('input[autocomplete="current-password"]');
        expect(primary.exists()).toBe(true);
        await primary.setValue(CT_PASSWORD);
        await click(wrapper, TEXT.generate);
        expect(calls.put[0]).toEqual({ id: MULDE, body: { primaryPwd: CT_PASSWORD } });
    });

    it('a chosen password: „✓ Gespeichert“ and the pill updates', async () => {
        const { wrapper, fakeBackend } = await start({ path: `/manage/${MULDE}` });
        await click(wrapper, TEXT.newPassword);
        await wrapper.find('input[type="radio"][value="custom"]').setValue(true);
        await wrapper.find('input[autocomplete="new-password"]').setValue('Zyxwvuts9876!abc');
        await click(wrapper, TEXT.submitCustom);
        expect(fakeBackend.entries.get(MULDE)).toBe('Zyxwvuts9876!abc');
        expect(wrapper.find('[role="status"].cps-manage__saved').text()).toBe(TEXT.saved);
        expect(pill(wrapper).text()).toBe(TEXT.isSet);
    });

    it('renews the session inside the click handler', async () => {
        const { wrapper, session, clock, open } = await start({ path: `/manage/${MUELLER}` });
        const fresh = vi.spyOn(session, 'ensureFresh');
        clock.now += 540_000;
        clickNow(wrapper, TEXT.newPassword);
        expect(fresh).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledTimes(1);
        await settle();
    });

    it('switching to another person closes the flow and drops what was typed', async () => {
        const { wrapper, router } = await start({ path: `/manage/${MUELLER}` });
        await click(wrapper, TEXT.newPassword);
        await wrapper.find('input[type="radio"][value="custom"]').setValue(true);
        await wrapper.find('input[autocomplete="new-password"]').setValue('Zyxwvuts9876!abc');
        await router.push(`/manage/${MULDE}`);
        await settle();
        expect(wrapper.find('.cps-flow').exists()).toBe(false);
        expect(wrapper.html()).not.toContain('Zyxwvuts9876!abc');
        expect(card(wrapper).text()).toContain('Bernd Mulde');
    });

    it('person-not-found from the backend shows its text', async () => {
        const { wrapper, fakeBackend } = await start({ path: `/manage/${MULDE}` });
        await click(wrapper, TEXT.newPassword);
        fakeBackend.failNext('person-not-found', 404);
        await click(wrapper, TEXT.generate);
        expect(wrapper.find('.cps-flow__error').text()).toContain(TEXT.personNotFound);
    });

    it('person-not-found while reading the status shows its text, never „Noch kein Passwort“', async () => {
        const s = await start({ path: '/manage' });
        s.fakeBackend.failNext('person-not-found', 404);
        await pick(s.wrapper, 'bernd', 'Bernd Mulde');
        expect(card(s.wrapper).text()).toContain(TEXT.personNotFound);
        expect(card(s.wrapper).text()).not.toContain(TEXT.none);
        expect(button(s.wrapper, TEXT.newPassword)).toBeUndefined();
    });

    it.each(['pending', 'failing'])('after a failed attempt, with the status read %s, a resubmit still asks first', async (mode) => {
        const { wrapper, calls, fakeBackend, gets } = await start({ path: `/manage/${MULDE}` });
        expect(pill(wrapper).text()).toBe(TEXT.none);
        await click(wrapper, TEXT.newPassword);
        if (mode === 'pending') gets.hold = new Promise<void>(() => undefined);
        else gets.fail = true;
        // A lost answer: the password may have been stored, the status is read again.
        fakeBackend.breakNext('unreachable', { afterWrite: true });
        await click(wrapper, TEXT.generate);
        expect(calls.put).toHaveLength(1);
        expect(dialog()).toBeNull();
        await click(wrapper, TEXT.generate);
        expect(dialogText()).toBe(TEXT.replaceText('Bernd Mulde'));
        expect(calls.put).toHaveLength(1);
        await answer(TEXT.cancel);
        expect(calls.put).toHaveLength(1);
    });

    it('a person known to have no entry is not asked about', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MULDE}` });
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.generate);
        expect(dialog()).toBeNull();
        expect(calls.put).toHaveLength(1);
    });

    it('a double click (direct path) opens one dialog and sends once', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, allowCustom: false, requirePrimary: false });
        clickNow(wrapper, TEXT.newPassword);
        clickNow(wrapper, TEXT.newPassword);
        await settle();
        await answer(TEXT.proceed);
        expect(dialog()).toBeNull();
        expect(calls.put).toHaveLength(1);
    });

    it('a blocked renewal popup: no flow, nothing sent, the frame’s „Sitzung erneuern“, no error', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, tokenLeftMs: 60_000 });
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-flow').exists()).toBe(false);
        expect(dialog()).toBeNull();
        expect(calls.put).toEqual([]);
        expect(wrapper.text()).toContain(SESSION_BANNER);
        expect(button(wrapper, 'Sitzung erneuern')).toBeDefined();
        expect(wrapper.find('.cps-manage__error').exists()).toBe(false);
    });

    it('a renewal that fails otherwise shows its error above the buttons', async () => {
        const { wrapper, session } = await start({ path: `/manage/${MUELLER}` });
        vi.spyOn(session, 'ensureFresh').mockRejectedValueOnce(new BackendUnreachable());
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-flow').exists()).toBe(false);
        expect(wrapper.find('.cps-manage__error').text()).toContain('Der Dienst ist gerade nicht erreichbar.');
    });

    it('a token problem during renewal while „Sitzung erneuern“ is up shows no extra error', async () => {
        const { wrapper, session } = await start({ path: `/manage/${MUELLER}` });
        session.needsRenewal.value = true;
        vi.spyOn(session, 'ensureFresh').mockRejectedValueOnce(new BackendProblem('invalid-token', 401));
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-manage__error').exists()).toBe(false);
        session.needsRenewal.value = false;
        vi.spyOn(session, 'ensureFresh').mockRejectedValueOnce(new BackendProblem('invalid-token', 401));
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-manage__error').exists()).toBe(true);
    });

    it('a slow renewal that succeeds opens the flow afterwards', async () => {
        const { wrapper, session } = await start({ path: `/manage/${MUELLER}` });
        const slow = deferred();
        vi.spyOn(session, 'ensureFresh').mockReturnValueOnce(slow.promise);
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-flow').exists()).toBe(false);
        slow.resolve();
        await settle();
        expect(wrapper.find('.cps-flow-for').text()).toBe(TEXT.forName('Jürgen Müller'));
    });

    it('another person chosen during a slow renewal: nothing opens', async () => {
        const { wrapper, session, router } = await start({ path: `/manage/${MUELLER}` });
        const slow = deferred();
        vi.spyOn(session, 'ensureFresh').mockReturnValueOnce(slow.promise);
        await click(wrapper, TEXT.newPassword);
        await router.push(`/manage/${MULDE}`);
        await settle();
        slow.resolve();
        await settle();
        expect(wrapper.find('.cps-flow').exists()).toBe(false);
        expect(card(wrapper).text()).toContain('Bernd Mulde');
    });

    it('no „✓ Gespeichert“ line after „Fertig“ on a generated password, nor after „Abbrechen“', async () => {
        const { wrapper } = await start({ path: `/manage/${MULDE}` });
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.generate);
        await click(wrapper, TEXT.done);
        expect(wrapper.find('.cps-manage__saved').exists()).toBe(false);
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.cancel);
        expect(wrapper.find('.cps-manage__saved').exists()).toBe(false);
    });

    it('leaving the flow reads the status again', async () => {
        const { wrapper, gets, fakeBackend } = await start({ path: `/manage/${MULDE}` });
        await click(wrapper, TEXT.newPassword);
        gets.fail = true;
        fakeBackend.breakNext('unreachable', { afterWrite: true });
        await click(wrapper, TEXT.generate);
        gets.fail = false;
        await click(wrapper, TEXT.cancel);
        expect(pill(wrapper).text()).toBe(TEXT.isSet);
    });
});

describe('selecting oneself', () => {
    it('gets the normal flow: no banner, no dialog, no „Löschen“', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${ME}`, entries: { [ME]: VALID } });
        expect(card(wrapper).text()).toContain('Anna Admin');
        expect(button(wrapper, TEXT.delete)).toBeUndefined();
        await click(wrapper, 'Neues Passwort festlegen');
        expect(wrapper.find('.cps-flow-for').exists()).toBe(false);
        await click(wrapper, TEXT.generate);
        expect(dialog()).toBeNull();
        expect(calls.put).toHaveLength(1);
    });

    it('with an entry: the 4.2 label and the hint', async () => {
        const { wrapper } = await start({ path: `/manage/${ME}`, entries: { [ME]: VALID } });
        expect(button(wrapper, 'Neues Passwort festlegen')).toBeDefined();
        expect(button(wrapper, TEXT.newPassword)).toBeUndefined();
        expect(wrapper.text()).toContain('Dein bisheriges Passwort funktioniert danach nicht mehr.');
    });

    it('without an entry: „Passwort festlegen“, no hint', async () => {
        const { wrapper } = await start({ path: `/manage/${ME}` });
        expect(button(wrapper, 'Passwort festlegen')).toBeDefined();
        expect(wrapper.text()).not.toContain('Dein bisheriges Passwort funktioniert danach nicht mehr.');
    });
});

describe('„Löschen“', () => {
    it('is a danger dialog naming the person with the focus on „Abbrechen“; cancelling deletes nothing', async () => {
        const { wrapper, calls, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.delete);
        expect(dialogText()).toBe(TEXT.deleteText('Jürgen Müller'));
        expect(dialog()!.querySelector('.cps-btn--danger')?.textContent?.trim()).toBe(TEXT.delete);
        expect(document.activeElement?.textContent?.trim()).toBe(TEXT.cancel);
        expect(dialogInput()).toBeFalsy();
        await answer(TEXT.cancel);
        expect(calls.del).toEqual([]);
        expect(fakeBackend.entries.get(MUELLER)).toBe(VALID);
    });

    it('deletes after confirming: „✓ Gelöscht“ and „Noch kein Passwort“', async () => {
        const { wrapper, calls, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.delete);
        await answer(TEXT.delete);
        expect(calls.del).toEqual([{ id: MUELLER }]);
        expect(fakeBackend.entries.has(MUELLER)).toBe(false);
        expect(wrapper.find('[role="status"].cps-manage__saved').text()).toBe(TEXT.deleted);
        expect(pill(wrapper).text()).toBe(TEXT.none);
    });

    it('with the password required: the admin’s password field is inside the dialog and is sent', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, requirePrimary: true });
        await click(wrapper, TEXT.delete);
        const input = dialogInput()!;
        expect(input.getAttribute('autocomplete')).toBe('current-password');
        expect(input.type).toBe('password');
        expect(dialog()!.textContent).toContain(TEXT.primaryLabel);
        expect(document.activeElement?.textContent?.trim()).toBe(TEXT.cancel);
        await typeInDialog(CT_PASSWORD);
        await answer(TEXT.delete);
        expect(calls.del).toEqual([{ id: MUELLER, primaryPwd: CT_PASSWORD }]);
        expect(dialog()).toBeNull();
        expect(everything(wrapper)).not.toContain(CT_PASSWORD);
    });

    it('the typed password is cleared when the dialog is cancelled', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, requirePrimary: true });
        await click(wrapper, TEXT.delete);
        await typeInDialog(CT_PASSWORD);
        await answer(TEXT.cancel);
        expect(calls.del).toEqual([]);
        expect(document.body.innerHTML).not.toContain(CT_PASSWORD);
        await click(wrapper, TEXT.delete);
        expect(dialogInput()!.value).toBe('');
    });

    it('a wrong ChurchTools password: its text, the entry stays', async () => {
        const { wrapper, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, requirePrimary: true });
        await click(wrapper, TEXT.delete);
        await typeInDialog('wrong');
        await answer(TEXT.delete);
        expect(wrapper.find('.cps-manage__error').text()).toContain(TEXT.primaryWrong);
        expect(fakeBackend.entries.get(MUELLER)).toBe(VALID);
        expect(pill(wrapper).text()).toBe(TEXT.isSet);
    });

    it('too many attempts: the minutes, clamped and in the plural', async () => {
        const { wrapper, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        fakeBackend.failNext('too-many-attempts', 429, { retryAfter: 61 });
        await click(wrapper, TEXT.delete);
        await answer(TEXT.delete);
        expect(wrapper.find('.cps-manage__error').text()).toContain('Zu viele Versuche. Versuch es in 2 Minuten noch einmal.');
    });

    it('a problem’s detail only as plain text under „Details“', async () => {
        const { wrapper, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        fakeBackend.failNext('internal-error', 500, { detail: '<b>boom</b>' });
        await click(wrapper, TEXT.delete);
        await answer(TEXT.delete);
        const error = wrapper.find('.cps-manage__error');
        expect(error.text()).toContain('Etwas ist schiefgelaufen (500).');
        expect(error.find('details').text()).toContain('<b>boom</b>');
        expect(error.find('details b').exists()).toBe(false);
    });

    it('renews the session inside the click handler, before the dialog', async () => {
        const { wrapper, session, clock, open } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        const fresh = vi.spyOn(session, 'ensureFresh');
        clock.now += 540_000;
        clickNow(wrapper, TEXT.delete);
        expect(fresh).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledTimes(1);
        await settle();
    });

    it('a delete confirmed after the page was left sends nothing', async () => {
        const { wrapper, router, calls, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.delete);
        await router.push('/about');
        await settle();
        await answer(TEXT.delete);
        expect(calls.del).toEqual([]);
        expect(fakeBackend.entries.get(MUELLER)).toBe(VALID);
    });

    it('a delete confirmed after another person was selected sends nothing', async () => {
        const { wrapper, router, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.delete);
        await router.push(`/manage/${MULDE}`);
        await settle();
        await answer(TEXT.delete);
        expect(calls.del).toEqual([]);
    });

    it('a double click opens one dialog and deletes once', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        clickNow(wrapper, TEXT.delete);
        clickNow(wrapper, TEXT.delete);
        await settle();
        await answer(TEXT.delete);
        expect(dialog()).toBeNull();
        expect(calls.del).toHaveLength(1);
    });

    it('a blocked renewal popup: no dialog, nothing deleted, the frame’s „Sitzung erneuern“, no error', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, tokenLeftMs: 60_000 });
        await click(wrapper, TEXT.delete);
        expect(dialog()).toBeNull();
        expect(calls.del).toEqual([]);
        expect(wrapper.text()).toContain(SESSION_BANNER);
        expect(wrapper.find('.cps-manage__error').exists()).toBe(false);
    });

    it('a renewal that fails otherwise: no dialog, its error', async () => {
        const { wrapper, session, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        vi.spyOn(session, 'ensureFresh').mockRejectedValueOnce(new BackendUnreachable());
        await click(wrapper, TEXT.delete);
        expect(dialog()).toBeNull();
        expect(calls.del).toEqual([]);
        expect(wrapper.find('.cps-manage__error').text()).toContain('Der Dienst ist gerade nicht erreichbar.');
    });

    it('a slow renewal that succeeds opens the dialog afterwards', async () => {
        const { wrapper, session } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        const slow = deferred();
        vi.spyOn(session, 'ensureFresh').mockReturnValueOnce(slow.promise);
        await click(wrapper, TEXT.delete);
        expect(dialog()).toBeNull();
        slow.resolve();
        await settle();
        expect(dialogText()).toBe(TEXT.deleteText('Jürgen Müller'));
    });

    it('while the delete runs, both buttons are disabled', async () => {
        const { wrapper, dels } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        const slow = deferred();
        dels.hold = slow.promise;
        await click(wrapper, TEXT.delete);
        await answer(TEXT.delete);
        expect(button(wrapper, TEXT.newPassword)!.element.disabled).toBe(true);
        expect(button(wrapper, TEXT.delete)!.element.disabled).toBe(true);
        slow.resolve();
        await settle();
        expect(button(wrapper, TEXT.newPassword)!.element.disabled).toBe(false);
    });

    it('an error is cleared when another person is chosen', async () => {
        const { wrapper, fakeBackend, router } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        fakeBackend.failNext('internal-error', 500);
        await click(wrapper, TEXT.delete);
        await answer(TEXT.delete);
        expect(wrapper.find('.cps-manage__error').exists()).toBe(true);
        await router.push(`/manage/${MULDE}`);
        await settle();
        expect(wrapper.find('.cps-manage__error').exists()).toBe(false);
    });

    it('„Gelöscht“ is cleared when another person is chosen', async () => {
        const { wrapper, router } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        await click(wrapper, TEXT.delete);
        await answer(TEXT.delete);
        expect(wrapper.find('.cps-manage__saved').text()).toBe(TEXT.deleted);
        await router.push(`/manage/${MULDE}`);
        await settle();
        expect(wrapper.find('.cps-manage__saved').exists()).toBe(false);
    });

    it('with the password required, an empty field can’t confirm', async () => {
        const { wrapper, calls } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID }, requirePrimary: true });
        await click(wrapper, TEXT.delete);
        const confirmButton = dialog()!.querySelector<HTMLButtonElement>('[data-confirm]')!;
        expect(confirmButton.disabled).toBe(true);
        dialog()!.querySelector('form')!.dispatchEvent(new Event('submit'));
        await settle();
        expect(dialog()).not.toBeNull();
        expect(calls.del).toEqual([]);
    });

    it('person-not-found: its text, above the buttons', async () => {
        const { wrapper, fakeBackend } = await start({ path: `/manage/${MUELLER}`, entries: { [MUELLER]: VALID } });
        fakeBackend.failNext('person-not-found', 404);
        await click(wrapper, TEXT.delete);
        await answer(TEXT.delete);
        const error = wrapper.find('.cps-manage__error');
        expect(error.text()).toContain(TEXT.personNotFound);
        const actions = card(wrapper).find('.cps-form-actions').element;
        expect(error.element.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('ChurchTools names are plain text', () => {
    it('in the list, the card, the banner and both dialogs', async () => {
        const name = `Eva ${ODD_NAME}`;
        const { wrapper } = await start({ entries: { [ODD]: VALID } });
        await pick(wrapper, 'eva', name);
        expect(card(wrapper).find('.cps-manage__name').text()).toBe(name);
        expect(card(wrapper).find('b').exists()).toBe(false);
        await click(wrapper, TEXT.delete);
        expect(dialogText()).toBe(TEXT.deleteText(name));
        await answer(TEXT.cancel);
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-flow-for').text()).toBe(TEXT.forName(name));
        expect(wrapper.find('.cps-flow-for b').exists()).toBe(false);
        await click(wrapper, TEXT.generate);
        expect(dialogText()).toBe(TEXT.replaceText(name));
        expect(dialog()!.querySelector('b')).toBeNull();
    });

    it('names are isolated against bidi controls: <bdi> in the list, the card and the banner, U+2068/U+2069 (controls neutralised) in both dialogs', async () => {
        const name = `Rafa ${BIDI_LAST}`;
        /** In the dialogs' plain text the override itself is neutralised as well. */
        const inDialog = 'Rafa \uFFFDnamffoh';
        const { wrapper } = await start({ entries: { [BIDI]: VALID } });
        await search(wrapper, 'rafa');
        const option = wrapper.findAll('[role="option"]').find((o) => o.text().includes('Rafa'))!;
        expect(option.find('bdi.cps-picker__name').text()).toBe(name);
        await option.trigger('click');
        await settle();
        expect(card(wrapper).find('bdi.cps-manage__name').text()).toBe(name);
        await click(wrapper, TEXT.delete);
        expect(dialogText()).toBe(TEXT.deleteText(inDialog));
        await answer(TEXT.cancel);
        await click(wrapper, TEXT.newPassword);
        expect(wrapper.find('.cps-flow-for strong bdi').text()).toBe(name);
        expect(wrapper.find('.cps-flow-for').text()).toBe(TEXT.forName(name));
        await click(wrapper, TEXT.generate);
        expect(dialogText()).toBe(TEXT.replaceText(inDialog));
    });


    it('a name cannot close its isolate in the dialogs: its own bidi controls become U+FFFD there', async () => {
        const name = `Ida ${ESCAPE_LAST}`;
        const shown = 'Ida Beck\uFFFD\uFFFD';
        const { wrapper } = await start({ entries: { [ESCAPE]: VALID } });
        await pick(wrapper, 'ida', name);
        await click(wrapper, TEXT.delete);
        expect(dialogText()).toBe(TEXT.deleteText(shown));
        await answer(TEXT.cancel);
        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.generate);
        expect(dialogText()).toBe(TEXT.replaceText(shown));
    });

    it('the ChurchTools ID is shown under every name: list, card and both dialogs', async () => {
        const { wrapper } = await start({ twins: true, entries: { [TWIN_B]: VALID } });
        await search(wrapper, 'anna mü');
        const options = wrapper.findAll('[role="option"]');
        expect(options.map((o) => o.find('.cps-picker__detail').text())).toEqual([`ID ${TWIN_A}`, `ID ${TWIN_B}`]);
        await options[1]!.trigger('click');
        await settle();
        expect(card(wrapper).find('.cps-manage__name').text()).toBe('Anna Müller');
        const id = card(wrapper).find('.cps-manage__id');
        expect(id.text()).toBe(`ID ${TWIN_B}`);
        // Read as „Anna Müller, ID 7“.
        expect(card(wrapper).find('.cps-manage__ident').element.textContent).toBe(`Anna Müller, ID ${TWIN_B}`);

        await click(wrapper, TEXT.delete);
        expect(dialog()!.querySelector('.cps-confirm__subject-name')!.textContent).toBe('Anna Müller');
        expect(dialog()!.querySelector('.cps-confirm__subject-detail')!.textContent).toBe(`ID ${TWIN_B}`);
        expect(dialogText()).toBe(TEXT.deleteText('Anna Müller'));
        await answer(TEXT.cancel);

        await click(wrapper, TEXT.newPassword);
        await click(wrapper, TEXT.generate);
        expect(dialog()!.querySelector('.cps-confirm__subject-name')!.textContent).toBe('Anna Müller');
        expect(dialog()!.querySelector('.cps-confirm__subject-detail')!.textContent).toBe(`ID ${TWIN_B}`);
        expect(dialogText()).toBe(TEXT.replaceText('Anna Müller'));
    });

    it('the ID is shown for oneself and for a unique name too', async () => {
        const { wrapper } = await start({ path: `/manage/${ME}` });
        expect(card(wrapper).find('.cps-manage__id').text()).toBe(`ID ${ME}`);
    });

    it('finds a person by ChurchTools ID, exactly or as a prefix', async () => {
        const { wrapper } = await start({ twins: true });
        await search(wrapper, String(TWIN_B));
        expect(options(wrapper)).toEqual(['Anna Müller']);
        expect(wrapper.find('[role="option"] .cps-picker__detail').text()).toBe(`ID ${TWIN_B}`);
        await search(wrapper, `anna ${TWIN_A}`);
        expect(wrapper.findAll('[role="option"] .cps-picker__detail').map((d) => d.text())).toEqual([`ID ${TWIN_A}`]);
    });
});

/** Every value and text on the page, to make sure a password is gone. */
function everything(w: VueWrapper): string {
    return document.body.innerHTML + w.findAll('input').map((i) => (i.element as HTMLInputElement).value).join('|');
}
