import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory } from 'vue-router';
import App from '../App.vue';
import { SERVICES_KEY, type Services } from '../app/services';
import { BackendProblem } from '../backend/problems';
import { CALLBACK_WINDOW_KEY } from '../backend/auth';
import { EXTENSION_KEY } from '../config';
import { CtHttpError } from '../ct/errors';
import { createAppI18n } from '../i18n';
import { createAppRouter } from '../router';
import {
    DEMO_ADMIN_ID,
    DEMO_BACKEND_URL,
    DEMO_CT_PASSWORD,
    DEMO_SETTINGS_CATEGORY,
    DEMO_STORAGE_KEY,
    DEMO_USER_ID,
} from './demo-data';
import { createDemoServices, DEMO_SCENARIOS, mountDemoSwitch, type DemoEnv, type DemoScenario } from './services';

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

const ORIGIN = 'http://localhost:5173';

function env(storage: DemoEnv['storage'] = new MemoryStorage(), reload = vi.fn()): DemoEnv & { reload: ReturnType<typeof vi.fn> } {
    return { storage, origin: ORIGIN, reload, now: () => 1_800_000_000_000, appVersion: '1.4.2+abc' };
}

function withScenario(scenario: DemoScenario, storage = new MemoryStorage()): MemoryStorage {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ scenario }));
    return storage;
}

/** Startup as the app does it: the person and the settings bind the login. */
async function login(services: Services): Promise<void> {
    const me = await services.ct.whoami();
    const read = await services.store.readSettings();
    if (read.state !== 'ok' || !read.value.backendUrl || !read.value.oauthClientId) throw new Error('settings not ready');
    services.auth.configure({ backendUrl: read.value.backendUrl, clientId: read.value.oauthClientId });
    services.auth.bindPerson(me.id);
}

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    }
}

const mounted: { unmount(): void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    document.body.innerHTML = '';
});

describe('createDemoServices', () => {
    it('starts as the demo user, logged in to the demo backend with a matching version', async () => {
        const services = createDemoServices('de', env());
        expect((await services.ct.whoami()).id).toBe(DEMO_USER_ID);
        expect(services.demo.scenario).toBe('user');
        await login(services);
        expect(services.auth.tokenFor(DEMO_BACKEND_URL)).not.toBeNull();
        expect(services.auth.info()).toEqual({ admin: false, version: '1.4.2' });
        expect(services.appVersion).toBe('1.4.2+abc');
        expect(services.ctBaseUrl).toBe(ORIGIN);
        expect(await services.ct.moduleId(EXTENSION_KEY)).not.toBeNull();
    });

    it('acts as the demo admin in the admin scenario', async () => {
        const services = createDemoServices('de', env(withScenario('admin')));
        expect((await services.ct.whoami()).id).toBe(DEMO_ADMIN_ID);
        expect((await services.ct.globalPermissions())['edit custom data']).toContain(DEMO_SETTINGS_CATEGORY);
        await login(services);
        expect(services.auth.info()?.admin).toBe(true);
        await expect(services.backend(DEMO_BACKEND_URL).selfTest()).resolves.toMatchObject({ version: '1.4.2' });
    });

    it('has no view right in the no-access scenario', async () => {
        const services = createDemoServices('de', env(withScenario('no-access')));
        expect((await services.ct.globalPermissions()).view).toBe(false);
    });

    it('fails to read the rights in the churchtools-error scenario', async () => {
        const services = createDemoServices('de', env(withScenario('churchtools-error')));
        await expect(services.ct.globalPermissions()).rejects.toBeInstanceOf(CtHttpError);
    });

    it('logs in with another backend MAJOR version in the version-mismatch scenario', async () => {
        const services = createDemoServices('de', env(withScenario('version-mismatch')));
        await login(services);
        expect(services.auth.info()?.version).toBe('2.0.0');
    });

    it('has no settings in the setup-needed scenario, and its writes are not kept', async () => {
        const storage = withScenario('setup-needed');
        const services = createDemoServices('de', env(storage));
        expect((await services.store.readSettings()).state).toBe('missing');
        await services.ct.createValue((await services.ct.moduleId(EXTENSION_KEY))!, DEMO_SETTINGS_CATEGORY, '{"x":1}');
        const admin = createDemoServices('de', env(withScenario('admin', storage)));
        expect((await admin.store.readSettings()).state).toBe('ok');
    });

    it('keeps passwords across page loads (localStorage)', async () => {
        const storage = new MemoryStorage();
        const first = createDemoServices('de', env(storage));
        await login(first);
        await first.backend(DEMO_BACKEND_URL).putEntry(DEMO_USER_ID, { primaryPwd: DEMO_CT_PASSWORD });
        const second = createDemoServices('de', env(storage));
        await login(second);
        await expect(second.backend(DEMO_BACKEND_URL).getEntry(DEMO_USER_ID)).resolves.toBe('set');
        await second.backend(DEMO_BACKEND_URL).deleteEntry(DEMO_USER_ID, DEMO_CT_PASSWORD);
        const third = createDemoServices('de', env(storage));
        await expect(third.backend(DEMO_BACKEND_URL).getEntry(DEMO_USER_ID)).resolves.toBe('none');
    });

    it('keeps ChurchTools writes across page loads, and the backend follows the stored settings', async () => {
        const storage = withScenario('admin');
        const admin = createDemoServices('de', env(storage));
        const read = await admin.store.readSettings();
        if (read.state !== 'ok') throw new Error('settings expected');
        await admin.store.saveSettings({ ...read.value, allowCustomPassword: false }, read.value.revision);
        const again = createDemoServices('de', env(storage));
        const reread = await again.store.readSettings();
        expect(reread.state === 'ok' && reread.value.allowCustomPassword).toBe(false);
        const error = await again
            .backend(DEMO_BACKEND_URL)
            .putEntry(DEMO_ADMIN_ID, { primaryPwd: DEMO_CT_PASSWORD, secondaryPwd: 'Abcdefgh1234!xyz' })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BackendProblem);
        expect((error as BackendProblem).slug).toBe('custom-password-not-allowed');
    });

    it('asks for the demo ChurchTools password before a change', async () => {
        const services = createDemoServices('de', env());
        const error = await services.backend(DEMO_BACKEND_URL).putEntry(DEMO_USER_ID, { primaryPwd: 'wrong' }).catch((e: unknown) => e);
        expect((error as BackendProblem).slug).toBe('invalid-primary-password');
    });

    it('binds the token to the backend address in the stored settings, so a changed address still starts logged in', async () => {
        const storage = withScenario('admin');
        const admin = createDemoServices('de', env(storage));
        const read = await admin.store.readSettings();
        if (read.state !== 'ok') throw new Error('settings expected');
        await admin.store.saveSettings({ ...read.value, backendUrl: 'https://anderes-backend.demo.invalid' }, read.value.revision);
        const again = createDemoServices('de', env(storage));
        await login(again);
        expect(again.auth.tokenFor('https://anderes-backend.demo.invalid')).not.toBeNull();
    });

    it.each([
        ['not JSON', '{'],
        ['an array', '[]'],
        ['an unknown scenario', '{"scenario":"root"}'],
        ['broken values only', '{"scenario":"admin","values":[{"id":"x"}]}'],
        ['broken entries only (not a string)', '{"scenario":"admin","entries":{"9002":1}}'],
        ['an entries key 0', '{"scenario":"admin","entries":{"0":"x"}}'],
        ['an entries key with a leading zero', '{"scenario":"admin","entries":{"09002":"x"}}'],
    ])('starts from the invented data when the stored state is %s', async (_case, raw) => {
        const storage = new MemoryStorage();
        storage.setItem(DEMO_STORAGE_KEY, raw);
        const services = createDemoServices('de', env(storage));
        expect(services.demo.scenario).toBe('user');
        expect((await services.store.readSettings()).state).toBe('ok');
    });

    it('works without storage (blocked or throwing)', async () => {
        const throwing = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
            removeItem: () => {
                throw new Error('blocked');
            },
        };
        for (const storage of [null, throwing]) {
            const services = createDemoServices('de', env(storage));
            await login(services);
            await expect(services.backend(DEMO_BACKEND_URL).putEntry(DEMO_USER_ID, { primaryPwd: DEMO_CT_PASSWORD })).resolves.toHaveProperty('generated');
        }
    });

    it('ignores an entries key __proto__ (dropped, nothing polluted)', async () => {
        const storage = new MemoryStorage();
        storage.setItem(DEMO_STORAGE_KEY, '{"scenario":"admin","entries":{"__proto__":{"polluted":"x"}}}');
        const services = createDemoServices('de', env(storage));
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        await login(services);
        // The schema drops the key (valibot skips `__proto__`), so the kept entries are empty: Ada has no password.
        expect(services.demo.scenario).toBe('admin');
        await expect(services.backend(DEMO_BACKEND_URL).getEntry(DEMO_ADMIN_ID)).resolves.toBe('none');
    });

    it('keeps a valid stored state (control for the cases above)', () => {
        const storage = new MemoryStorage();
        storage.setItem(DEMO_STORAGE_KEY, '{"scenario":"admin","entries":{"9002":"x"}}');
        expect(createDemoServices('de', env(storage)).demo.scenario).toBe('admin');
    });

    it.each([
        ['empty', ''],
        ['not a string', 42],
    ])('binds the token to the demo backend when the stored address is %s', async (_case, backendUrl) => {
        const storage = new MemoryStorage();
        const values = [
            { id: 1, dataCategoryId: DEMO_SETTINGS_CATEGORY, value: JSON.stringify({ schema: 2, revision: 1, backendUrl }) },
        ];
        storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ scenario: 'admin', values }));
        const services = createDemoServices('de', env(storage));
        services.auth.configure({ backendUrl: DEMO_BACKEND_URL, clientId: 'c' });
        services.auth.bindPerson(DEMO_ADMIN_ID);
        expect(services.auth.tokenFor(DEMO_BACKEND_URL)).not.toBeNull();
    });

    it.each([
        ['a refused password change', (s: Services) => s.backend(DEMO_BACKEND_URL).putEntry(DEMO_USER_ID, { primaryPwd: 'wrong' })],
        ['a refused ChurchTools write', async (s: Services) => s.ct.createValue((await s.ct.moduleId(EXTENSION_KEY))!, DEMO_SETTINGS_CATEGORY, '{}')],
    ])('keeps the state also after %s', async (_case, write) => {
        const storage = new MemoryStorage();
        const services = createDemoServices('de', env(storage));
        await expect(write(services)).rejects.toBeDefined();
        const kept = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!) as { scenario: string; entries: Record<string, string> };
        expect(kept.scenario).toBe('user');
        expect(Object.keys(kept.entries)).toEqual([String(DEMO_ADMIN_ID)]);
    });

    it('switches the scenario: kept, then reload', () => {
        const storage = new MemoryStorage();
        const e = env(storage);
        createDemoServices('de', e).demo.setScenario('admin');
        expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!).scenario).toBe('admin');
        expect(e.reload).toHaveBeenCalledTimes(1);
    });

    it('resets everything, then reloads', () => {
        const storage = withScenario('admin');
        const e = env(storage);
        createDemoServices('de', e).demo.reset();
        expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
        expect(e.reload).toHaveBeenCalledTimes(1);
    });

    it('reloads on reset also when the storage refuses to remove', () => {
        const storage = withScenario('admin');
        storage.removeItem = () => {
            throw new Error('blocked');
        };
        const e = env(storage);
        expect(() => createDemoServices('de', e).demo.reset()).not.toThrow();
        expect(e.reload).toHaveBeenCalledTimes(1);
    });

    it('shows the password page with the demo data', async () => {
        const services = createDemoServices('de', env());
        const router = createAppRouter(createMemoryHistory());
        await router.push('/');
        const wrapper = mount(App, {
            attachTo: document.body,
            global: {
                plugins: [router, createAppI18n('de')],
                provide: { [SERVICES_KEY as symbol]: services, [CALLBACK_WINDOW_KEY as symbol]: { opener: null, origin: ORIGIN, close: vi.fn() } },
            },
        });
        mounted.push(wrapper);
        await settle();
        // The user's card: the demo user has no password yet (the demo admin has one).
        expect(wrapper.text()).toContain('Mein Zweitpasswort');
        expect(wrapper.text()).toContain('Noch kein Passwort');
        expect(wrapper.text()).toContain('Passwort festlegen');
    });
});

describe('mountDemoSwitch', () => {
    it('offers every scenario with the current one selected, as plain text', () => {
        const controls = { scenario: 'admin' as DemoScenario, setScenario: vi.fn(), reset: vi.fn() };
        const el = mountDemoSwitch(document, controls);
        const select = el.querySelector('select')!;
        expect([...select.options].map((o) => o.value)).toEqual([...DEMO_SCENARIOS]);
        expect(select.value).toBe('admin');
        expect(el.textContent).toContain(DEMO_CT_PASSWORD);
        expect(el.querySelector('script, [onclick]')).toBeNull();
        expect(document.body.contains(el)).toBe(true);
    });

    it('switches and resets through the controls', () => {
        const controls = { scenario: 'user' as DemoScenario, setScenario: vi.fn(), reset: vi.fn() };
        const el = mountDemoSwitch(document, controls);
        const select = el.querySelector('select')!;
        select.value = 'no-access';
        select.dispatchEvent(new Event('change'));
        expect(controls.setScenario).toHaveBeenCalledWith('no-access');
        el.querySelector('button')!.click();
        expect(controls.reset).toHaveBeenCalledTimes(1);
    });
});
