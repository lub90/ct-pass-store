<script setup lang="ts">
/**
 * The frame chosen by role (E3) and the one global `ConfirmDialog` (spec 5.1). Pages are drawn only when the app
 * state and the route's `requires` allow it (`routeView`); before that only the state's own text is, so no page
 * content shows early, and a page meant for another role shows the missing-rights banner (spec 4.1, 8.1).
 */
import { computed, inject, provide } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { currentNav, frameFor, routeView, type NavPath } from './app/app-state';
import { useServices } from './app/services';
import { APP_STATE_KEY, createAppState } from './app/useAppState';
import { SESSION_KEY, createSession } from './app/useSession';
import { AUTH_KEY, CALLBACK_WINDOW_KEY, callbackWindow } from './backend/auth';
import { APP_VERSION } from './config';
import Banner from './ui/Banner.vue';
import ConfirmDialog from './ui/ConfirmDialog.vue';
import type { IconName } from './ui/Icon.vue';
import PageFrame from './ui/PageFrame.vue';
import StatusLine from './ui/StatusLine.vue';
import StateView from './views/StateView.vue';
import SessionBanner from './views/SessionBanner.vue';
import WaitingView from './views/WaitingView.vue';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const services = useServices();

// A session in the services (tests) is used as is; otherwise the app makes its own.
const session = services.session ?? createSession(services.auth, () => router.currentRoute.value.fullPath);
provide(SESSION_KEY, session);
provide(AUTH_KEY, services.auth);

const app = createAppState({
    services,
    router,
    session,
    callbackWindow: inject(CALLBACK_WINDOW_KEY, null) ?? callbackWindow(),
    appVersion: services.appVersion ?? APP_VERSION,
});
provide(APP_STATE_KEY, app);
void app.start();

const NAV: Record<NavPath, { label: string; icon: IconName }> = {
    '/': { label: 'nav.myPassword', icon: 'key' },
    '/manage': { label: 'nav.manage', icon: 'people' },
    '/settings': { label: 'nav.settings', icon: 'settings' },
    '/about': { label: 'nav.about', icon: 'info' },
};

const state = computed(() => app.state.value);
const frame = computed(() => frameFor(state.value, app.settingsEditor.value));
const nav = computed(() => frame.value.nav.map((to) => ({ to, label: t(NAV[to].label), icon: NAV[to].icon, bottom: to === '/about' })));
const current = computed(() => currentNav(route.path, frame.value.nav));
const view = computed(() => routeView(state.value, app.settingsEditor.value, route.path, route.meta.requires));
const waiting = computed(() => state.value === 'setup-needed' || state.value === 'migration-needed');
/** Normal users reach „Über“ through a small link in the card's footer (spec 4.1). */
const footerLink = computed(() =>
    frame.value.mode === 'card' && view.value !== 'state' ? (route.path === '/about' ? { to: '/', label: t('nav.myPassword') } : { to: '/about', label: t('nav.about') }) : null,
);

function navigate(to: string): void {
    void router.push(to);
}
</script>

<template>
    <PageFrame
        :mode="frame.mode"
        :nav="nav"
        :nav-label="t('nav.label')"
        :current="current"
        @navigate="navigate"
    >
        <StatusLine
            v-if="state === 'loading'"
            kind="loading"
            :text="app.onCallback.value ? t('auth.finishing') : t('state.loading')"
        />
        <template v-else-if="view === 'page'">
            <!-- Spec 7.2: on every page, so a blocked renewal can be retried wherever the person is. -->
            <SessionBanner class="cps-app__session" />
            <!-- A page whose route says so is a fresh instance per path (e.g. one machine client after another). -->
            <RouterView v-slot="{ Component, route: shown }">
                <component
                    :is="Component"
                    :key="shown.meta.remount ? shown.path : undefined"
                />
            </RouterView>
        </template>
        <template v-else-if="view === 'missing-rights'">
            <Banner kind="warning">
                <p>{{ t(route.meta.requires === 'admin' ? 'state.needsAdmin' : 'state.needsEditor') }}</p>
            </Banner>
            <p class="cps-app__back">
                <RouterLink to="/">
                    {{ t('notFound.back') }}
                </RouterLink>
            </p>
        </template>
        <WaitingView
            v-else-if="waiting"
            :setup-capable="app.setupCapable.value"
        />
        <StateView v-else />
        <footer
            v-if="footerLink"
            class="cps-app__footer"
        >
            <RouterLink :to="footerLink.to">
                {{ footerLink.label }}
            </RouterLink>
        </footer>
    </PageFrame>
    <!-- On body, above ChurchTools' top bar whatever stacking contexts the host page creates around the app. -->
    <Teleport to="body">
        <div class="cps cps-app__dialogs">
            <ConfirmDialog />
        </div>
    </Teleport>
</template>

<style scoped>
.cps-app__session {
    margin-bottom: var(--cps-space-4);
}

.cps-app__back {
    margin-top: var(--cps-space-3);
}

.cps-app__footer {
    margin-top: var(--cps-space-5);
    padding-top: var(--cps-space-3);
    border-top: 1px solid var(--cps-divider);
    font-size: var(--cps-size-sm);
}
</style>
