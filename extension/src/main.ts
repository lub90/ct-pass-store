import { churchtoolsClient } from '@churchtools/churchtools-client';


// only import reset.css in development mode to keep the production bundle small and to simulate CT environment
if (import.meta.env.MODE === 'development') {
    import('./utils/reset.css');
}

declare const window: Window &
    typeof globalThis & {
        settings: {
            base_url?: string;
        };
    };

const baseUrl = window.settings?.base_url ?? import.meta.env.VITE_BASE_URL;
churchtoolsClient.setBaseUrl(baseUrl);

const username = import.meta.env.VITE_USERNAME;
const password = import.meta.env.VITE_PASSWORD;
if (import.meta.env.MODE === 'development' && username && password) {
    await churchtoolsClient.post('/login', { username, password });
}

const KEY = import.meta.env.VITE_KEY;
export { KEY };

// Include bootstrap
const bootstrapCss = document.createElement('link');
bootstrapCss.rel = 'stylesheet';
bootstrapCss.href = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css';
document.head.appendChild(bootstrapCss);

const bootstrapIconCss = document.createElement('link');
bootstrapIconCss.rel = 'stylesheet';
bootstrapIconCss.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css';
document.head.appendChild(bootstrapIconCss);


// Setup angular
import { createApp } from 'vue';
import App from './layout/BaseLayout.vue';
import { router } from './router';

const mountPoint = document.querySelector('#app');
if (mountPoint) {
  mountPoint.innerHTML = '<div id="vue-root"></div>';
  createApp(App).use(router).mount('#vue-root');
}