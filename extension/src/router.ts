/**
 * All routes of spec 4.1, below `/ccm/ctpassstore/`. There are no route guards: `App.vue` draws a page only when the
 * app state and the route's `requires` allow it (`routeView`), and each page checks the rights it needs. Pages of
 * later steps are placeholders until then.
 */
import { createRouter, createWebHistory, type RouteRecordRaw, type RouterHistory } from 'vue-router';
import type { RouteRequirement } from './app/app-state';
import { BASE_PATH, CALLBACK_PATH } from './config';
import AuthCallbackView from './views/AuthCallbackView.vue';
import ManageView from './views/ManageView.vue';
import NotFoundView from './views/NotFoundView.vue';
import PasswordView from './views/PasswordView.vue';
import PlaceholderView from './views/PlaceholderView.vue';
import AccessView from './views/settings/AccessView.vue';
import ClientFormView from './views/settings/ClientFormView.vue';
import RulesView from './views/settings/RulesView.vue';
import SettingsView from './views/settings/SettingsView.vue';
import TextsView from './views/settings/TextsView.vue';

declare module 'vue-router' {
    interface RouteMeta {
        /** i18n key of a placeholder page's title. */
        titleKey?: string;
        /** Who the page is for (spec 4.1); without it, everyone with access. */
        requires?: RouteRequirement;
    }
}

const placeholder = (path: string, titleKey: string, requires?: RouteRequirement): RouteRecordRaw => ({
    path,
    component: PlaceholderView,
    meta: requires ? { titleKey, requires } : { titleKey },
});

export const routes: RouteRecordRaw[] = [
    { path: '/', component: PasswordView },
    // One record for both, so choosing another person keeps the page (and its loaded members).
    { path: '/manage/:personId?', component: ManageView, meta: { requires: 'admin' } },
    { path: '/settings', component: SettingsView, meta: { requires: 'editor' } },
    { path: '/settings/rules', component: RulesView, meta: { requires: 'editor' } },
    { path: '/settings/texts', component: TextsView, meta: { requires: 'editor' } },
    { path: '/settings/access', component: AccessView, meta: { requires: 'editor' } },
    // `new` is matched first; an id `new` can't be edited here (a client named so is still listed and removable).
    { path: '/settings/access/clients/new', component: ClientFormView, meta: { requires: 'editor' } },
    { path: '/settings/access/clients/:id', component: ClientFormView, meta: { requires: 'editor' } },
    placeholder('/settings/backend', 'pages.backend', 'editor'),
    placeholder('/settings/backup', 'pages.backup', 'admin'),
    placeholder('/settings/setup', 'pages.setup', 'admin'),
    placeholder('/about', 'nav.about'),
    { path: `/${CALLBACK_PATH}`, component: AuthCallbackView },
    { path: '/:pathMatch(.*)*', component: NotFoundView },
];

export function createAppRouter(history: RouterHistory = createWebHistory(BASE_PATH)) {
    return createRouter({ history, routes });
}
