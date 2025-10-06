import { createRouter, createWebHistory } from 'vue-router';
import PasswordPage from './pages/PasswordPage.vue';
import SetupPage from './pages/SetupPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import { AppConfig } from './AppConfig';

const base = '/ccm/' + AppConfig.EXTENSION_KEY + '/';

export const router = createRouter({
  history: createWebHistory(base),
  routes: [
    { path: '/password', component: PasswordPage },
    { path: '/setup', component: SetupPage },
    { path: '/settings', component: SettingsPage },
    { path: '/', redirect: '/password' }
  ]
});
