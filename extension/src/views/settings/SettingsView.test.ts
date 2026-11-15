/**
 * App layer (mounted): the settings overview (spec 4.4) by role and right, with its two status pills.
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { createMemoryHistory } from 'vue-router';
import { SERVICES_KEY, type Services } from '../../app/services';
import { APP_STATE_KEY, type AppStateHandle } from '../../app/useAppState';
import type { BackendApi } from '../../backend/api';
import { BackendUnreachable } from '../../backend/problems';
import { createAppI18n } from '../../i18n';
import { createAppRouter } from '../../router';
import SettingsView from './SettingsView.vue';
import { ACCESS, BACKEND, SETTINGS, cleanup, settle, start, type SelfTestTests } from './settings-harness';

afterEach(cleanup);

const CARDS = {
    rules: ['Passwortregeln', 'Länge, eigene Passwörter, Bestätigung', '/settings/rules'],
    texts: ['Texte', 'Titel und Erklärung pro Sprache', '/settings/texts'],
    access: ['Zugriff', 'Admin-Gruppe und Maschinen-Clients', '/settings/access'],
    backend: ['Backend & Status', 'Adresse und Selbsttest', '/settings/backend'],
    backup: ['Sicherung', 'Daten sichern und wiederherstellen', '/settings/backup'],
    setup: ['Einrichtung', 'Rechte und Gruppen prüfen oder reparieren', '/settings/setup'],
} as const;

const missing = (category: string) => `Dir fehlt in ChurchTools das Recht „edit custom data“ auf die Kategorie „${category}“.`;

const cards = (w: VueWrapper) => w.findAll('main .cps-linkcard');
const titles = (w: VueWrapper) => cards(w).map((c) => c.find('.cps-linkcard__title').text());
const card = (w: VueWrapper, title: string) => {
    const found = cards(w).find((c) => c.find('.cps-linkcard__title').text() === title);
    if (!found) throw new Error(`No card „${title}“ in: ${titles(w).join(', ')}`);
    return found;
};
const pill = (w: VueWrapper, title: string) => {
    const p = card(w, title).find('.cps-pill');
    return p.exists() ? p.text() : null;
};

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');
const client = (id: string, key: string) => ({ id, name: id, publicKeys: [key], permissions: ['entries:read'], createdAt: '2026-11-01' });

const failing = (n: number): (() => Promise<{ version: string; summary: string; tests: SelfTestTests }>) => () =>
    Promise.resolve({
        version: '0.1.0',
        summary: 'x',
        tests: [
            { name: 'settings', status: 'ok', message: 'ok' },
            ...Array.from({ length: n }, (_, i) => ({ name: `check-${i}`, status: 'fail' as const, message: '<b>broken</b>' })),
        ],
    });

describe('settings overview (spec 4.4)', () => {
    it('shows the header and, for a setup-capable admin with all rights, the six cards in order with their sentences', async () => {
        const { wrapper } = await start({ path: '/settings', setupCapable: true });
        expect(wrapper.find('h1').text()).toBe('Einstellungen');
        expect(titles(wrapper)).toEqual(Object.values(CARDS).map(([title]) => title));
        for (const [title, text, to] of Object.values(CARDS)) {
            const c = card(wrapper, title);
            expect(c.find('.cps-linkcard__text').text()).toBe(text);
            expect(c.element.tagName).toBe('A');
            expect(c.attributes('href')).toBe(to);
        }
    });

    it('hides Sicherung and Einrichtung for an admin who is not setup-capable', async () => {
        const { wrapper } = await start({ path: '/settings', setupCapable: false });
        expect(titles(wrapper)).toEqual([CARDS.rules[0], CARDS.texts[0], CARDS.access[0], CARDS.backend[0]]);
    });

    it('hides Sicherung and Einrichtung for a setup-capable settings editor who is no admin', async () => {
        const { wrapper } = await start({ path: '/settings', admin: false, setupCapable: true });
        expect(titles(wrapper)).not.toContain('Sicherung');
        expect(titles(wrapper)).not.toContain('Einrichtung');
    });

    it('an admin without the rights on settings sees Regeln, Texte and Backend disabled, naming the right', async () => {
        const { wrapper } = await start({ path: '/settings', edit: ['access'] });
        for (const title of [CARDS.rules[0], CARDS.texts[0], CARDS.backend[0]]) {
            const c = card(wrapper, title);
            expect(c.element.tagName).toBe('DIV');
            expect(c.attributes('aria-disabled')).toBe('true');
            expect(c.find('.cps-linkcard__reason').text()).toBe(missing('settings'));
            expect(c.find('a').exists()).toBe(false);
        }
        // Admins reach „Zugriff“ (they read `access`, spec 16.2 A2).
        expect(card(wrapper, CARDS.access[0]).element.tagName).toBe('A');
    });

    it('a settings editor of settings only (no admin) gets Zugriff disabled, naming the right on access', async () => {
        const { wrapper } = await start({ path: '/settings', admin: false, edit: ['settings'] });
        const access = card(wrapper, CARDS.access[0]);
        expect(access.element.tagName).toBe('DIV');
        expect(access.find('.cps-linkcard__reason').text()).toBe(missing('access'));
        for (const title of [CARDS.rules[0], CARDS.texts[0], CARDS.backend[0]]) expect(card(wrapper, title).element.tagName).toBe('A');
    });

    it('a settings editor of access only (no admin) gets Regeln, Texte and Backend disabled', async () => {
        const { wrapper } = await start({ path: '/settings', admin: false, edit: ['access'] });
        expect(card(wrapper, CARDS.access[0]).element.tagName).toBe('A');
        for (const title of [CARDS.rules[0], CARDS.texts[0], CARDS.backend[0]]) expect(card(wrapper, title).find('.cps-linkcard__reason').text()).toBe(missing('settings'));
    });
});

describe('Backend & Status pill (GET /v1/test)', () => {
    it('shows ✓ for a passing self-test (the read-only one)', async () => {
        const { wrapper, selfTests } = await start({ path: '/settings' });
        expect(selfTests).toHaveLength(1);
        expect(selfTests[0]).toBeFalsy();
        expect(pill(wrapper, CARDS.backend[0])).toBe('✓');
        expect(card(wrapper, CARDS.backend[0]).find('.cps-pill--ok').exists()).toBe(true);
    });

    it('shows „⚠ 2 Probleme“ for two failed checks, and „⚠ 1 Problem“ for one; never the messages', async () => {
        const two = await start({ path: '/settings', selfTest: failing(2) });
        expect(pill(two.wrapper, CARDS.backend[0])).toBe('⚠ 2 Probleme');
        expect(card(two.wrapper, CARDS.backend[0]).find('.cps-pill--warning').exists()).toBe(true);
        expect(two.wrapper.text()).not.toContain('broken');
        cleanup();
        const one = await start({ path: '/settings', selfTest: failing(1) });
        expect(pill(one.wrapper, CARDS.backend[0])).toBe('⚠ 1 Problem');
    });

    it('says when the self-test could not run', async () => {
        const { wrapper } = await start({ path: '/settings', selfTest: () => Promise.reject(new BackendUnreachable()) });
        expect(pill(wrapper, CARDS.backend[0])).toBe('⚠ Nicht geprüft');
    });

    it('is not asked for by a settings editor who is no admin (the self-test is for admins)', async () => {
        const { wrapper, selfTests } = await start({ path: '/settings', admin: false });
        expect(selfTests).toEqual([]);
        expect(pill(wrapper, CARDS.backend[0])).toBeNull();
    });
});

describe('self-test cache (S4)', () => {
    it('runs once per visit and is reused for 5 minutes when coming back', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const { wrapper, router, selfTests } = await start({ path: '/settings', selfTest: failing(2) });
        expect(selfTests).toHaveLength(1);
        await router.push('/settings/rules');
        await settle();
        await router.push('/settings');
        await settle();
        expect(selfTests).toHaveLength(1);
        expect(pill(wrapper, CARDS.backend[0])).toBe('⚠ 2 Probleme');
        now.mockReturnValue(1_000_000 + 5 * 60_000 - 1);
        await router.push('/');
        await settle();
        await router.push('/settings');
        await settle();
        expect(selfTests).toHaveLength(1);
        now.mockReturnValue(1_000_000 + 5 * 60_000);
        await router.push('/');
        await settle();
        await router.push('/settings');
        await settle();
        expect(selfTests).toHaveLength(2);
    });

    it('a failed run is not kept: the next visit asks again', async () => {
        let calls = 0;
        const { router, selfTests } = await start({ path: '/settings', selfTest: () => (calls++ === 0 ? Promise.reject(new BackendUnreachable()) : failing(0)()) });
        await router.push('/');
        await settle();
        await router.push('/settings');
        await settle();
        expect(selfTests).toHaveLength(2);
    });
});

describe('Zugriff pill', () => {
    it('an admin without the edit right on access gets Zugriff disabled, naming the right (the page needs it)', async () => {
        const { wrapper } = await start({ path: '/settings', edit: ['settings'], access: { ...ACCESS, machineClients: [client('wlan', KEY_A)] } });
        const c = card(wrapper, CARDS.access[0]);
        expect(c.element.tagName).toBe('DIV');
        expect(c.find('.cps-linkcard__reason').text()).toBe(missing('access'));
        expect(pill(wrapper, CARDS.access[0])).toBeNull();
    });

    it('shows the number of machine clients', async () => {
        const two = await start({ path: '/settings', access: { ...ACCESS, machineClients: [client('wlan', KEY_A), client('radius', KEY_B)] } });
        expect(pill(two.wrapper, CARDS.access[0])).toBe('2 Clients');
        cleanup();
        const one = await start({ path: '/settings', access: { ...ACCESS, machineClients: [client('wlan', KEY_A)] } });
        expect(pill(one.wrapper, CARDS.access[0])).toBe('1 Client');
        cleanup();
        const none = await start({ path: '/settings' });
        expect(pill(none.wrapper, CARDS.access[0])).toBe('Keine Clients');
    });

    it('is not read for a person who can’t use „Zugriff“', async () => {
        const { wrapper, router, storeReads: reads } = await start({ path: '/', admin: false, edit: ['settings'], viewAccess: false });
        const before = reads.access;
        await router.push('/settings');
        await settle();
        expect(reads.access).toBe(before);
        expect(pill(wrapper, CARDS.access[0])).toBeNull();
    });
});

describe('self-test cache key', () => {
    /** The overview alone, with a hand-made app state, so the cache can hold an entry for another address. */
    async function mountOverview(cache: { baseUrl: string; at: number; failed: number }) {
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const asked: string[] = [];
        const selfTestCache = ref<{ baseUrl: string; at: number; failed: number } | null>(cache);
        const app = {
            state: computed(() => 'admin'),
            failure: computed(() => null),
            settingsEditor: ref({ settings: true, access: false }),
            setupCapable: ref(false),
            settings: ref({ ...SETTINGS }),
            selfTestCache,
        } as unknown as AppStateHandle;
        const services = {
            backend: (url: string) => ({ selfTest: () => (asked.push(url), failing(2)()) }) as unknown as BackendApi,
        } as unknown as Services;
        const router = createAppRouter(createMemoryHistory());
        await router.push('/settings');
        const wrapper = mount(SettingsView, {
            global: { plugins: [router, createAppI18n('de')], provide: { [SERVICES_KEY as symbol]: services, [APP_STATE_KEY as symbol]: app } },
        });
        await settle();
        return { wrapper, asked, selfTestCache };
    }

    it('a fresh entry for another backend address is not used: the configured one is asked and replaces it', async () => {
        const { wrapper, asked, selfTestCache } = await mountOverview({ baseUrl: 'https://other.example', at: 1_000_000, failed: 0 });
        expect(asked).toEqual([BACKEND]);
        expect(selfTestCache.value).toEqual({ baseUrl: BACKEND, at: 1_000_000, failed: 2 });
        expect(wrapper.find('.cps-pill').text()).toBe('⚠ 2 Probleme');
        wrapper.unmount();
    });

    it('a fresh entry for the configured address is used as is', async () => {
        const { wrapper, asked } = await mountOverview({ baseUrl: BACKEND, at: 1_000_000, failed: 0 });
        expect(asked).toEqual([]);
        expect(wrapper.find('.cps-pill').text()).toBe('✓');
        wrapper.unmount();
    });
});

describe('the page checks its own rights, on top of the frame (spec 4.1)', () => {
    it.each(['user', 'backend-error', 'no-access'] as const)('mounted alone in %s, without settings rights: the banner, no card, nothing read or asked', async (state) => {
        const readAccess = vi.fn();
        const backend = vi.fn();
        const app = {
            state: computed(() => state),
            failure: computed(() => null),
            settingsEditor: ref({ settings: false, access: false }),
            setupCapable: ref(true),
            settings: ref({ ...SETTINGS }),
            selfTestCache: ref(null),
        } as unknown as AppStateHandle;
        const services = { store: { readAccess }, backend } as unknown as Services;
        const router = createAppRouter(createMemoryHistory());
        await router.push('/settings');
        const wrapper = mount(SettingsView, {
            global: { plugins: [router, createAppI18n('de')], provide: { [SERVICES_KEY as symbol]: services, [APP_STATE_KEY as symbol]: app } },
        });
        await settle();
        expect(wrapper.find('.cps-banner--warning').text()).toBe('Diese Seite ist nur für Admins und für Personen, die die Einstellungen ändern dürfen.');
        expect(wrapper.findAll('.cps-linkcard')).toHaveLength(0);
        expect(readAccess).not.toHaveBeenCalled();
        expect(backend).not.toHaveBeenCalled();
        wrapper.unmount();
    });
});
