/**
 * Test harness for the settings pages (imported by their tests only): the whole app with the real `Auth`, session and
 * store over the fake ChurchTools (values really stored, rights really checked) and the fake backend. Only the
 * browser (storage, popup, clock) is faked.
 */
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { vi } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, type Router } from 'vue-router';
import App from '../../App.vue';
import { SERVICES_KEY, type Services } from '../../app/services';
import { createSession } from '../../app/useSession';
import type { BackendApi, SelfTestResult } from '../../backend/api';
import { Auth, CALLBACK_WINDOW_KEY, TOKEN_KEY, type AuthEnv, type CallbackWindow } from '../../backend/auth';
import { backendBase } from '../../backend/http';
import type { CtApi } from '../../ct/api';
import type { CtValue, Permissions } from '../../ct/types';
import { createFakeBackend } from '../../dev/fake-backend';
import { createFakeChurchTools, type FakeCtSeed, type FakeGroup } from '../../dev/fake-churchtools';
import { createAppI18n } from '../../i18n';
import { createAppRouter } from '../../router';
import { ChurchToolsKv } from '../../store/churchtools-kv';
import { ExtensionStore } from '../../store/repository';
import { answerConfirm } from '../../ui/useConfirm';

export const ORIGIN = 'https://ct.example';
export const BACKEND = 'https://pw.example';
export const NOW = 1_800_000_000_000;
export const ME = 1;
export const SETTINGS_ID = 11;
export const ACCESS_ID = 12;
export const SETTINGS_VALUE_ID = 101;
export const ACCESS_VALUE_ID = 102;

export const SETTINGS = {
    schema: 2,
    revision: 4,
    requirePasswordForPasswordChange: true,
    allowCustomPassword: false,
    passwordLength: 16,
    backendUrl: BACKEND,
    oauthClientId: 'oauth-client-1',
};

export const ACCESS = {
    schema: 2,
    revision: 1,
    groups: {
        users: { groupId: 40, createdBySetup: true },
        admins: { groupId: 41, createdBySetup: true },
        service: { groupId: 42, createdBySetup: true },
    },
    machineClients: [] as unknown[],
};

export interface HarnessOptions {
    path: string;
    /** The token's admin flag (the login answer); default true. */
    admin?: boolean;
    /** `edit custom data` (and create/delete) on these categories; default both. */
    edit?: ('settings' | 'access')[];
    /** `view custom data` on `access`; default true. */
    viewAccess?: boolean;
    setupCapable?: boolean;
    /** The stored settings: an object (JSON-encoded) or raw text. */
    settings?: unknown;
    access?: unknown;
    /** Replaces the fake backend's self-test. */
    selfTest?: BackendApi['selfTest'];
    /** ChurchTools groups (default none) and the ones the person has "view group" on. */
    groups?: FakeGroup[];
    viewGroupIds?: number[];
    /** More persons than the logged-in one (ME, „Anna Admin“). */
    persons?: FakeCtSeed['persons'];
    /** The extension's version (default 0.1.0) and the backend's from the login answer (default 0.1.0). */
    appVersion?: string;
    backendVersion?: string;
    /** Stands in for `location.reload()`. */
    reloadPage?: () => void;
    /** More values stored next to `settings` and `access` (duplicates, E1), with value ids from 301. */
    extra?: { category: 'settings' | 'access'; value: unknown }[];
}

const mounted: VueWrapper[] = [];

/** For `afterEach`. */
export function cleanup(): void {
    while (mounted.length) mounted.pop()!.unmount();
    answerConfirm({ confirmed: false });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
}

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

export function permissions(o: Pick<HarnessOptions, 'edit' | 'viewAccess' | 'setupCapable'>): Permissions {
    const edit = (o.edit ?? ['settings', 'access']).map((c) => (c === 'settings' ? SETTINGS_ID : ACCESS_ID));
    const view = o.viewAccess === false ? [SETTINGS_ID] : [SETTINGS_ID, ACCESS_ID];
    return {
        view: true,
        'create custom category': o.setupCapable ?? false,
        'view custom category': view,
        'edit custom category': [],
        'delete custom category': [],
        'view custom data': view,
        'create custom data': edit,
        'edit custom data': edit,
        'delete custom data': edit,
    };
}

/** The token belongs to the backend of the stored settings (so an odd stored address still starts logged in). */
const startupUrl = (settings: unknown): string =>
    typeof settings === 'object' && settings !== null && typeof (settings as { backendUrl?: unknown }).backendUrl === 'string' ? (settings as { backendUrl: string }).backendUrl : BACKEND;

const encode = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

export async function start(o: HarnessOptions) {
    const settings = o.settings === undefined ? SETTINGS : o.settings;
    const access = o.access === undefined ? ACCESS : o.access;
    const values: CtValue[] = [{ id: SETTINGS_VALUE_ID, dataCategoryId: SETTINGS_ID, value: encode(settings) }];
    if (access !== null) values.push({ id: ACCESS_VALUE_ID, dataCategoryId: ACCESS_ID, value: encode(access) });
    (o.extra ?? []).forEach((x, i) => values.push({ id: 301 + i, dataCategoryId: x.category === 'settings' ? SETTINGS_ID : ACCESS_ID, value: encode(x.value) }));
    const fakeCt = createFakeChurchTools({
        moduleKey: 'ctpassstore',
        moduleId: 7,
        currentPersonId: ME,
        persons: [{ id: ME, firstName: 'Anna', lastName: 'Admin' }, ...(o.persons ?? [])],
        groups: o.groups ?? [],
        viewGroupIds: o.viewGroupIds ?? [],
        categories: [
            { id: SETTINGS_ID, name: 'settings', shorty: 'settings' },
            { id: ACCESS_ID, name: 'access', shorty: 'access' },
        ],
        values,
        permissions: permissions(o),
    });
    const reads = { settings: 0, access: 0 };
    const writes: { categoryId: number; value: string }[] = [];
    const ct: CtApi = {
        ...fakeCt,
        values: (moduleId, categoryId) => {
            if (categoryId === SETTINGS_ID) reads.settings++;
            if (categoryId === ACCESS_ID) reads.access++;
            return fakeCt.values(moduleId, categoryId);
        },
        updateValue: (moduleId, categoryId, valueId, value) => (writes.push({ categoryId, value }), fakeCt.updateValue(moduleId, categoryId, valueId, value)),
        createValue: (moduleId, categoryId, value) => (writes.push({ categoryId, value }), fakeCt.createValue(moduleId, categoryId, value)),
    };
    const admin = o.admin ?? true;
    const fakeBackend = createFakeBackend({ personId: ME, admin, ctOrigin: ORIGIN, version: '0.1.0' });
    /** The `write` argument of each self-test call. */
    const selfTests: (boolean | undefined)[] = [];
    const backend: BackendApi = {
        ...fakeBackend,
        selfTest: (write) => (selfTests.push(write), (o.selfTest ?? fakeBackend.selfTest)(write)),
    };

    const storage = new MemoryStorage();
    const env: AuthEnv = {
        origin: ORIGIN,
        instanceBaseUrl: ORIGIN,
        redirectPath: '/ccm/ctpassstore/auth/callback',
        storage: () => storage,
        assign: () => undefined,
        open: () => null,
        listen: () => () => undefined,
        every: () => () => undefined,
        now: () => NOW,
    };
    storage.setItem(
        TOKEN_KEY,
        JSON.stringify({ accessToken: jwt(ME), expiresAt: NOW + 600_000, admin, version: o.backendVersion ?? '0.1.0', backend: backendBase(startupUrl(settings)), person: ME }),
    );
    const router: Router = createAppRouter(createMemoryHistory());
    const auth = new Auth(() => backend, env);
    const session = createSession(auth, () => router.currentRoute.value.fullPath);
    const store = new ExtensionStore(new ChurchToolsKv(ct, 'ctpassstore'));
    /** Reads through the store, whatever ChurchTools answers (a category the person can't see is never listed). */
    const storeReads = { settings: 0, access: 0 };
    const readSettings = store.readSettings.bind(store);
    const readAccess = store.readAccess.bind(store);
    store.readSettings = () => (storeReads.settings++, readSettings());
    store.readAccess = () => (storeReads.access++, readAccess());
    /** Every address a backend API was asked for (only the configured one may ever get the token). */
    const backendUrls: string[] = [];
    const services: Services = {
        session,
        ct,
        store,
        auth,
        backend: (url) => (backendUrls.push(url), backend),
        language: 'de',
        appVersion: o.appVersion ?? '0.1.0',
        ctBaseUrl: ORIGIN,
        ...(o.reloadPage ? { reloadPage: o.reloadPage } : {}),
    };
    const win: CallbackWindow = { opener: null, origin: ORIGIN, close: vi.fn() };
    await router.push(o.path);
    const wrapper = mount(App, {
        attachTo: document.body,
        global: { plugins: [router, createAppI18n('de')], provide: { [SERVICES_KEY as symbol]: services, [CALLBACK_WINDOW_KEY as symbol]: win } },
    });
    mounted.push(wrapper);
    await settle();
    /** The stored settings value as JSON (what ChurchTools holds now). */
    const stored = async (): Promise<Record<string, unknown>> => {
        const list = await fakeCt.values(7, SETTINGS_ID);
        return JSON.parse(list.find((x) => x.id === SETTINGS_VALUE_ID)!.value) as Record<string, unknown>;
    };
    /** Another tab (or person) saves meanwhile. */
    const changeElsewhere = async (change: Record<string, unknown>): Promise<void> => {
        const current = await stored();
        await fakeCt.updateValue(7, SETTINGS_ID, SETTINGS_VALUE_ID, JSON.stringify({ ...current, ...change, revision: (current.revision as number) + 1 }));
    };
    /**
     * Replaces the stored settings as they are (no revision raised). An invalid value at startup is `setup-needed`
     * and no settings page shows, so tests that need one start valid, replace it, then open the page.
     */
    const replaceStored = async (value: unknown): Promise<void> => {
        await fakeCt.updateValue(7, SETTINGS_ID, SETTINGS_VALUE_ID, encode(value));
    };
    /** Replaces the stored settings, then opens `path` (from another page, so the page mounts fresh). */
    const openWith = async (value: unknown, path: string): Promise<void> => {
        await replaceStored(value);
        await router.push(path);
        await settle();
    };
    /** Deletes the stored settings value (nothing stored any more). */
    const removeStored = async (): Promise<void> => {
        await fakeCt.deleteValue(7, SETTINGS_ID, SETTINGS_VALUE_ID);
    };
    /** The stored access value as JSON. */
    const storedAccess = async (): Promise<Record<string, unknown>> => {
        const list = await fakeCt.values(7, ACCESS_ID);
        return JSON.parse(list.find((x) => x.id === ACCESS_VALUE_ID)!.value) as Record<string, unknown>;
    };
    /** Another tab (or person) saves `access` meanwhile (revision raised). */
    const changeAccessElsewhere = async (change: Record<string, unknown>): Promise<void> => {
        const current = await storedAccess();
        await fakeCt.updateValue(7, ACCESS_ID, ACCESS_VALUE_ID, JSON.stringify({ ...current, ...change, revision: (current.revision as number) + 1 }));
    };
    /** Replaces the stored access value as it is (no revision raised). */
    const replaceAccess = async (value: unknown): Promise<void> => {
        await fakeCt.updateValue(7, ACCESS_ID, ACCESS_VALUE_ID, encode(value));
    };
    /** Another value appears next to the stored one (a duplicate, E1); returns its value id. */
    const plant = async (category: 'settings' | 'access', value: unknown): Promise<number> => (await fakeCt.createValue(7, category === 'settings' ? SETTINGS_ID : ACCESS_ID, encode(value))).id;
    /** Every stored value of a category (id and parsed JSON, or the raw text if it isn't JSON). */
    const all = async (category: 'settings' | 'access'): Promise<{ id: number; value: unknown }[]> =>
        (await fakeCt.values(7, category === 'settings' ? SETTINGS_ID : ACCESS_ID)).map((x) => {
            try {
                return { id: x.id, value: JSON.parse(x.value) as unknown };
            } catch {
                return { id: x.id, value: x.value };
            }
        });
    return { plant, all, session, auth, backendUrls, storedAccess, changeAccessElsewhere, replaceAccess, removeStored, wrapper, router, fakeCt, ct, store, reads, storeReads, writes, selfTests, stored, changeElsewhere, replaceStored, openWith };
}

export async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    }
}

export const button = (w: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> | undefined => w.findAll('button').find((b) => b.text() === text);

export async function click(w: VueWrapper, text: string): Promise<void> {
    const b = button(w, text);
    if (!b) throw new Error(`No button „${text}“ in: ${w.text()}`);
    b.element.click();
    await settle();
}

export const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('.cps-confirm__dialog');

export async function answer(label: string): Promise<void> {
    const b = [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((x) => x.textContent?.trim() === label);
    if (!b) throw new Error(`No dialog button „${label}“`);
    b.click();
    await settle();
}

export type SelfTestTests = SelfTestResult['tests'];
