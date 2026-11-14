import { createRouter, createWebHistory } from 'vue-router';
import { BASE_PATH, CALLBACK_PATH } from './config';
import PlaceholderView from './PlaceholderView.vue';
import AuthCallbackView from './views/AuthCallbackView.vue';

export const router = createRouter({
    history: createWebHistory(BASE_PATH),
    routes: [
        { path: '/', component: PlaceholderView },
        { path: `/${CALLBACK_PATH}`, component: AuthCallbackView },
    ],
});
