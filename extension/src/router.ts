import { createRouter, createWebHistory } from 'vue-router';
import { BASE_PATH } from './config';
import PlaceholderView from './PlaceholderView.vue';

export const router = createRouter({
    history: createWebHistory(BASE_PATH),
    routes: [{ path: '/', component: PlaceholderView }],
});
