import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import PasswordView from './views/PasswordView.vue';
import SetupView from './views/SetupView.vue';
import SettingsView from './views/SettingsView.vue';
import { AppConfig } from './AppConfig';

const prefix: String = AppConfig.getExtensionUrlPrefix();

const routes: RouteRecordRaw[] = [
  { path: prefix + '/', redirect: prefix + '/password' }, // Default redirect
  { path: prefix + '/password', component: PasswordView },
  { path: prefix + '/setup', component: SetupView },
  { path: prefix + '/settings', component: SettingsView },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
