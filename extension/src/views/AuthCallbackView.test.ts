import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { AUTH_KEY, CALLBACK_WINDOW_KEY, LoginStateError, POPUP_MESSAGE, type Auth, type CallbackWindow } from '../backend/auth';
import { createAppI18n } from '../i18n';
import AuthCallbackView from './AuthCallbackView.vue';

const Target = defineComponent({ render: () => h('div', { class: 'target' }) });

async function mountAt(url: string, options: { complete?: Auth['completePageLogin']; opener?: CallbackWindow['opener']; withoutAuth?: boolean } = {}) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/auth/callback', component: AuthCallbackView },
            { path: '/:rest(.*)*', component: Target },
        ],
    });
    await router.push(url);
    await router.isReady();
    const completePageLogin = vi.fn(options.complete ?? (async () => '/manage/5'));
    const auth = { completePageLogin } as unknown as Auth;
    const win: CallbackWindow = { opener: options.opener ?? null, origin: 'https://ct.example.org', close: vi.fn() };
    const wrapper = mount(AuthCallbackView, {
        global: {
            plugins: [router, createAppI18n('de')],
            provide: { ...(options.withoutAuth ? {} : { [AUTH_KEY as symbol]: auth }), [CALLBACK_WINDOW_KEY as symbol]: win },
        },
    });
    await flushPromises();
    return { wrapper, router, completePageLogin, win };
}

describe('AuthCallbackView', () => {
    it('as a page completes the login and goes to the remembered path', async () => {
        const { router, completePageLogin, wrapper } = await mountAt('/auth/callback?code=c1&state=s1');
        expect(completePageLogin).toHaveBeenCalledExactlyOnceWith({ code: 'c1', state: 's1' });
        expect(router.currentRoute.value.fullPath).toBe('/manage/5');
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('shows only a status line while it works', async () => {
        const { wrapper } = await mountAt('/auth/callback?code=c1&state=s1', { complete: () => new Promise<string>(() => undefined) });
        expect(wrapper.findAll('p')).toHaveLength(1);
        expect(wrapper.find('[role="status"]').text()).toBe('Anmeldung wird abgeschlossen …');
    });

    it('shows the login error, removes the code from the address and stays', async () => {
        const { router, wrapper } = await mountAt('/auth/callback?code=secret&state=s1', {
            complete: async () => {
                throw new LoginStateError();
            },
        });
        expect(wrapper.find('[role="alert"]').text()).toBe('Die Anmeldung hat nicht geklappt. Lade die Seite neu.');
        expect(router.currentRoute.value.fullPath).toBe('/auth/callback');
        expect(wrapper.text()).not.toContain('secret');
    });

    it('as a popup hands code and state to the opener and closes, without exchanging the code', async () => {
        const opener = { postMessage: vi.fn() };
        const state = 'p.' + 'x'.repeat(43);
        const { completePageLogin, win } = await mountAt(`/auth/callback?code=c2&state=${state}`, { opener });
        expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith({ type: POPUP_MESSAGE, code: 'c2', state }, 'https://ct.example.org');
        expect(win.close).toHaveBeenCalledOnce();
        expect(completePageLogin).not.toHaveBeenCalled();
    });

    it('shows the error for a popup callback without an opener and removes the code', async () => {
        const { completePageLogin, wrapper, router } = await mountAt(`/auth/callback?code=c2&state=p.${'x'.repeat(43)}`);
        expect(completePageLogin).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe('/auth/callback');
    });

    it('closes a popup the person declined, without an alert and without a page login', async () => {
        const opener = { postMessage: vi.fn() };
        const { completePageLogin, wrapper, win } = await mountAt(`/auth/callback?error=access_denied&state=p.${'x'.repeat(43)}`, { opener });
        expect(win.close).toHaveBeenCalledOnce();
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(completePageLogin).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('shows the error for a malformed popup state and posts nothing', async () => {
        const opener = { postMessage: vi.fn() };
        const { completePageLogin, wrapper, win, router } = await mountAt('/auth/callback?code=c2&state=p.', { opener });
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(win.close).not.toHaveBeenCalled();
        expect(completePageLogin).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe('/auth/callback');
    });

    it('completes a page login even when the tab has an opener', async () => {
        const opener = { postMessage: vi.fn() };
        const { completePageLogin, router, win } = await mountAt(`/auth/callback?code=c3&state=${'x'.repeat(43)}`, { opener });
        expect(completePageLogin).toHaveBeenCalledOnce();
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(win.close).not.toHaveBeenCalled();
        expect(router.currentRoute.value.fullPath).toBe('/manage/5');
    });

    it('shows the error and removes the code when no Auth is provided', async () => {
        const { wrapper, router } = await mountAt('/auth/callback?code=c4&state=s4', { withoutAuth: true });
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe('/auth/callback');
    });
});
