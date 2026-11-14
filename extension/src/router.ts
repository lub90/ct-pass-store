/**
 * All routes of spec 4.1, below `/ccm/ctpassstore/`. There are no route guards: `App.vue` draws a page only when the
 * app state allows it, and each page checks the rights it needs. Pages of later steps are placeholders until then.
 */
import { createRouter, createWebHistory, type RouteRecordRaw, type RouterHistory } from 'vue-router';
import { BASE_PATH, CALLBACK_PATH } from './config';
import AuthCallbackView from './views/AuthCallbackView.vue';
import NotFoundView from './views/NotFoundView.vue';
import PlaceholderView from './views/PlaceholderView.vue';

declare module 'vue-router' {
    interface RouteMeta {
        /** i18n key of a placeholder page's title. */
        titleKey?: string;
    }
}

const placeholder = (path: string, titleKey: string): RouteRecordRaw => ({ path, component: PlaceholderView, meta: { titleKey } });

export const routes: RouteRecordRaw[] = [
    placeholder('/', 'nav.myPassword'),
    placeholder('/manage', 'nav.manage'),
    placeholder('/manage/:personId', 'nav.manage'),
    placeholder('/settings', 'nav.settings'),
    placeholder('/settings/rules', 'pages.rules'),
    placeholder('/settings/texts', 'pages.texts'),
    placeholder('/settings/access', 'pages.access'),
    placeholder('/settings/access/clients/new', 'pages.client'),
    placeholder('/settings/access/clients/:id', 'pages.client'),
    placeholder('/settings/backend', 'pages.backend'),
    placeholder('/settings/backup', 'pages.backup'),
    placeholder('/settings/setup', 'pages.setup'),
    placeholder('/about', 'nav.about'),
    { path: `/${CALLBACK_PATH}`, component: AuthCallbackView },
    { path: '/:pathMatch(.*)*', component: NotFoundView },
];

export function createAppRouter(history: RouterHistory = createWebHistory(BASE_PATH)) {
    return createRouter({ history, routes });
}
