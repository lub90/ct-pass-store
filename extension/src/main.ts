import './ui/theme.css';
import { createApp } from 'vue';
import App from './App.vue';
import { SESSION_KEY, createSession } from './app/useSession';
import { createBackendApi } from './backend/api';
import { AUTH_KEY, Auth } from './backend/auth';
import { createAppI18n, pickLanguage } from './i18n';
import { router } from './router';

const i18n = createAppI18n(pickLanguage(navigator.languages));
// Configured with `settings.backendUrl` and `settings.oauthClientId` once the settings are loaded (Task 11).
const auth: Auth = new Auth((baseUrl) => createBackendApi(baseUrl, () => auth.token()));
const session = createSession(auth, () => router.currentRoute.value.fullPath);

createApp(App).use(i18n).use(router).provide(AUTH_KEY, auth).provide(SESSION_KEY, session).mount('#app');
