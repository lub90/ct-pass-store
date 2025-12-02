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
// TODO: Remove later on
const bootstrapCss = document.createElement('link');
bootstrapCss.rel = 'stylesheet';
bootstrapCss.href = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css';
document.head.appendChild(bootstrapCss);

const bootstrapIconCss = document.createElement('link');
bootstrapIconCss.rel = 'stylesheet';
bootstrapIconCss.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css';
document.head.appendChild(bootstrapIconCss);


// Setup vue
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';

// Setup vuetify
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css' 
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
  },
})

// Import vuetify fonts
import '@fontsource/roboto/100.css'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '@fontsource/roboto/900.css'
import '@fontsource/roboto/100-italic.css'
import '@fontsource/roboto/300-italic.css'
import '@fontsource/roboto/400-italic.css'
import '@fontsource/roboto/500-italic.css'
import '@fontsource/roboto/700-italic.css'
import '@fontsource/roboto/900-italic.css'


const app = createApp(App);
app.provide('churchtoolsClient', churchtoolsClient);    // Provide churchtools client globally
app.use(router).use(vuetify).mount('#app');


