/**
 * Demo mode, the default of `npm run dev` (spec 13.6): the app runs against `FakeChurchTools` and `FakeBackend` with
 * the invented data of `demo-data.ts`, so development never writes into a real instance. The state (scenario,
 * stored values, passwords) is kept in `localStorage` — only here, only in development. A small floating switch
 * changes the scenario.
 *
 * `main.ts` selects this module only when `import.meta.env.DEV && import.meta.env.MODE !== 'real'`; a production
 * build drops it (`check-dist` fails on the demo marker or any demo data string).
 */
import * as v from 'valibot';
import type { BackendApi } from '../backend/api';
import { Auth, TOKEN_KEY, type AuthEnv, type StorageLike } from '../backend/auth';
import { backendBase } from '../backend/http';
import { APP_VERSION, BASE_PATH, CALLBACK_PATH, EXTENSION_KEY } from '../config';
import type { CtApi } from '../ct/api';
import { CtHttpError } from '../ct/errors';
import type { CtValue } from '../ct/types';
import type { Language } from '../i18n';
import { ChurchToolsKv } from '../store/churchtools-kv';
import { ExtensionStore } from '../store/repository';
import type { Services } from '../app/services';
import {
    DEMO_ACCESS_CATEGORY,
    DEMO_ADMIN_ID,
    DEMO_ADMIN_VIEW_GROUPS,
    DEMO_BACKEND_URL,
    DEMO_CT_PASSWORD,
    DEMO_MODULE_ID,
    DEMO_PERMISSIONS,
    DEMO_SEED,
    DEMO_SETTINGS_CATEGORY,
    DEMO_STORAGE_KEY,
    DEMO_USER_ID,
} from './demo-data';
import { createFakeBackend } from './fake-backend';
import { createFakeChurchTools } from './fake-churchtools';
import { tagDemo } from './marker';

export const DEMO_SCENARIOS = ['user', 'admin', 'setup-needed', 'no-access', 'churchtools-error', 'version-mismatch'] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

const SCENARIO_LABELS: Record<DemoScenario, string> = {
    user: 'Nutzer (Bruno)',
    admin: 'Admin (Ada)',
    'setup-needed': 'Einrichtung fehlt',
    'no-access': 'Kein Zugriff',
    'churchtools-error': 'ChurchTools-Fehler',
    'version-mismatch': 'Versionen passen nicht',
};

export interface DemoControls {
    readonly scenario: DemoScenario;
    /** Keeps the scenario and reloads the page. */
    setScenario(scenario: DemoScenario): void;
    /** Forgets everything the demo kept and reloads the page. */
    reset(): void;
}

/** The browser as the demo needs it; `startDemo` passes the real one, tests pass fakes. */
export interface DemoEnv {
    /** `localStorage`; may be missing or throw (then nothing is kept). */
    storage: StorageLike | null;
    origin: string;
    reload(): void;
    now(): number;
    /** The extension's version; the demo backend answers with the same `x.y.z`. */
    appVersion: string;
}

const StateSchema = v.object({
    scenario: v.optional(v.picklist(DEMO_SCENARIOS)),
    values: v.optional(v.array(v.object({ id: v.pipe(v.number(), v.safeInteger()), dataCategoryId: v.pipe(v.number(), v.safeInteger()), value: v.string() }))),
    entries: v.optional(v.record(v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/)), v.string())),
});
type DemoState = v.InferOutput<typeof StateSchema>;

/** The kept state; anything unreadable counts as nothing kept (the invented data). */
function loadState(storage: StorageLike | null): DemoState {
    let raw: string | null;
    try {
        raw = storage?.getItem(DEMO_STORAGE_KEY) ?? null;
    } catch {
        return {};
    }
    if (raw === null) return {};
    try {
        const parsed = v.safeParse(StateSchema, JSON.parse(raw));
        return parsed.success ? parsed.output : {};
    } catch {
        return {};
    }
}

function saveState(storage: StorageLike | null, state: DemoState): void {
    try {
        storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Blocked storage: the demo still works, it just forgets on reload.
    }
}

class MemoryStorage implements StorageLike {
    private readonly map = new Map<string, string>();
    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
    removeItem(key: string): void {
        this.map.delete(key);
    }
}

const seedValues = (): CtValue[] => [
    { id: 1, dataCategoryId: DEMO_SETTINGS_CATEGORY, value: JSON.stringify(DEMO_SEED.settings) },
    { id: 2, dataCategoryId: DEMO_ACCESS_CATEGORY, value: JSON.stringify(DEMO_SEED.access) },
];

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The stored settings value as the fake backend reads it (like the real one reads the KV store); `{}` if unreadable. */
function storedSettings(values: CtValue[]): Record<string, unknown> {
    const raw = values.find((x) => x.dataCategoryId === DEMO_SETTINGS_CATEGORY)?.value;
    try {
        const parsed: unknown = raw === undefined ? null : JSON.parse(raw);
        return isObject(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** A token shaped like the backend's (the app reads `sub`); the signature is fake. */
function demoJwt(personId: number): string {
    const part = (x: unknown) => btoa(JSON.stringify(x)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: String(personId), iss: 'demo' })}.ZGVtbw`;
}

/** `x.y.z` of the app's version; for the mismatch scenario, the next MAJOR. */
function backendVersion(appVersion: string, mismatch: boolean): string {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(appVersion);
    const [major, minor, patch] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 1, 0];
    return mismatch ? `${major + 1}.0.0` : `${major}.${minor}.${patch}`;
}

export function createDemoServices(language: Language, env: DemoEnv): Services & { demo: DemoControls } {
    const state = loadState(env.storage);
    const scenario: DemoScenario = state.scenario ?? 'user';
    const asAdmin = scenario !== 'user' && scenario !== 'no-access';
    const me = asAdmin ? DEMO_ADMIN_ID : DEMO_USER_ID;
    // The setup-needed scenario starts without settings and keeps nothing it writes (the other scenarios stay intact).
    const keepCt = scenario !== 'setup-needed';
    const keptValues = state.values ?? seedValues();
    const values = keepCt ? keptValues : keptValues.filter((x) => x.dataCategoryId !== DEMO_SETTINGS_CATEGORY);
    const entries: Record<number, string> = state.entries
        ? Object.fromEntries(Object.entries(state.entries).map(([id, pwd]) => [Number(id), pwd]))
        : { ...DEMO_SEED.entries };

    const permissions = asAdmin ? DEMO_PERMISSIONS.admin : DEMO_PERMISSIONS.user;
    const fakeCt = createFakeChurchTools({
        moduleKey: EXTENSION_KEY,
        moduleId: DEMO_MODULE_ID,
        currentPersonId: me,
        persons: DEMO_SEED.persons,
        groups: DEMO_SEED.groups,
        categories: DEMO_SEED.categories,
        values,
        permissions: scenario === 'no-access' ? { ...permissions, view: false } : permissions,
        viewGroupIds: asAdmin ? DEMO_ADMIN_VIEW_GROUPS : [],
    });

    const keep = (): void => {
        saveState(env.storage, {
            ...loadState(env.storage),
            scenario,
            ...(keepCt ? { values: fakeCt.dumpValues() } : {}),
            entries: Object.fromEntries([...fakeBackend.entries].map(([id, pwd]) => [String(id), pwd])),
        });
    };
    /** Runs a write and keeps the state afterwards, also when it failed (a timeout may come after the write). */
    const kept = <T>(write: () => Promise<T>): Promise<T> => write().finally(keep);

    const ct: CtApi = {
        ...fakeCt,
        globalPermissions: () =>
            scenario === 'churchtools-error' ? Promise.reject(new CtHttpError(503, 'Demo: ChurchTools is unavailable')) : fakeCt.globalPermissions(),
        createValue: (...args) => kept(() => fakeCt.createValue(...args)),
        updateValue: (...args) => kept(() => fakeCt.updateValue(...args)),
        deleteValue: (...args) => kept(() => fakeCt.deleteValue(...args)),
    };

    const version = backendVersion(env.appVersion, scenario === 'version-mismatch');
    const fakeBackend = createFakeBackend({
        personId: me,
        admin: asAdmin,
        existingPersonIds: DEMO_SEED.persons.filter((p) => !('archived' in p && p.archived)).map((p) => p.id),
        primaryPassword: DEMO_CT_PASSWORD,
        version,
        entries,
        ctOrigin: env.origin,
    });
    /** Like the real backend, the fake follows the stored settings on every request. */
    const syncSettings = (): void => {
        const s = storedSettings(fakeCt.dumpValues());
        fakeBackend.setSettings({
            ...(typeof s.requirePasswordForPasswordChange === 'boolean' ? { requirePasswordForPasswordChange: s.requirePasswordForPasswordChange } : {}),
            ...(typeof s.allowCustomPassword === 'boolean' ? { allowCustomPassword: s.allowCustomPassword } : {}),
            ...(typeof s.passwordLength === 'number' ? { passwordLength: s.passwordLength } : {}),
        });
    };
    const backendApi: BackendApi = {
        login: (...args) => fakeBackend.login(...args),
        getEntry: (id) => (syncSettings(), fakeBackend.getEntry(id)),
        putEntry: (id, body) => (syncSettings(), kept(() => fakeBackend.putEntry(id, body))),
        deleteEntry: (id, pwd) => (syncSettings(), kept(() => fakeBackend.deleteEntry(id, pwd))),
        selfTest: (write) => (syncSettings(), fakeBackend.selfTest(write)),
    };

    // The login is already done: the token belongs to the backend the stored settings name, so a changed address in
    // the demo still starts logged in after the reload.
    const sessionStorage = new MemoryStorage();
    const stored = storedSettings(values).backendUrl;
    const tokenBackend = typeof stored === 'string' && stored !== '' ? stored : DEMO_BACKEND_URL;
    sessionStorage.setItem(
        TOKEN_KEY,
        JSON.stringify({
            accessToken: demoJwt(me),
            expiresAt: env.now() + 24 * 60 * 60 * 1000,
            admin: asAdmin,
            version,
            backend: backendBase(tokenBackend),
            person: me,
        }),
    );
    const authEnv: AuthEnv = {
        origin: env.origin,
        instanceBaseUrl: env.origin,
        redirectPath: `${BASE_PATH}${CALLBACK_PATH}`,
        storage: () => sessionStorage,
        // No real OAuth in the demo: a login that would leave the page does nothing, a popup is "blocked".
        assign: () => undefined,
        open: () => null,
        listen: () => () => undefined,
        every: () => () => undefined,
        now: env.now,
    };
    const auth = new Auth(() => backendApi, authEnv);

    const demo: DemoControls = {
        scenario,
        setScenario(next) {
            saveState(env.storage, { ...loadState(env.storage), scenario: next });
            env.reload();
        },
        reset() {
            try {
                env.storage?.removeItem(DEMO_STORAGE_KEY);
            } catch {
                // Nothing kept anyway.
            }
            env.reload();
        },
    };

    return tagDemo({
        ct,
        store: new ExtensionStore(new ChurchToolsKv(ct, EXTENSION_KEY)),
        auth,
        backend: () => backendApi,
        language,
        appVersion: env.appVersion,
        ctBaseUrl: env.origin,
        reloadPage: env.reload,
        demo,
    });
}

/** The floating switch: scenario, the demo ChurchTools password, and a reset. Plain DOM with text only. */
export function mountDemoSwitch(doc: Document, controls: DemoControls): HTMLElement {
    const box = doc.createElement('aside');
    box.setAttribute('aria-label', 'Demo-Modus');
    Object.assign(box.style, {
        position: 'fixed',
        right: '8px',
        bottom: '8px',
        zIndex: '2000',
        padding: '6px 8px',
        font: '12px/1.4 system-ui, sans-serif',
        background: '#fff8c5',
        color: '#3b2f00',
        border: '1px solid #c9a800',
        borderRadius: '6px',
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        flexWrap: 'wrap',
        maxWidth: 'calc(100vw - 16px)',
    });

    const label = doc.createElement('label');
    label.textContent = 'Demo: ';
    const select = doc.createElement('select');
    for (const scenario of DEMO_SCENARIOS) {
        const option = doc.createElement('option');
        option.value = scenario;
        option.textContent = SCENARIO_LABELS[scenario];
        select.append(option);
    }
    select.value = controls.scenario;
    select.addEventListener('change', () => controls.setScenario(select.value as DemoScenario));
    label.append(select);

    const hint = doc.createElement('span');
    hint.textContent = `ChurchTools-Passwort: ${DEMO_CT_PASSWORD}`;

    const reset = doc.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Zurücksetzen';
    reset.addEventListener('click', () => controls.reset());

    box.append(label, hint, reset);
    doc.body.append(box);
    return box;
}

/** `main.ts` in demo mode: the demo services for this browser, with the switch on the page. */
export function startDemo(language: Language): Services {
    let storage: StorageLike | null;
    try {
        storage = window.localStorage;
    } catch {
        storage = null;
    }
    const services = createDemoServices(language, {
        storage,
        origin: window.location.origin,
        reload: () => window.location.reload(),
        now: () => Date.now(),
        appVersion: APP_VERSION,
    });
    mountDemoSwitch(document, services.demo);
    return services;
}
