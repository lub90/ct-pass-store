import './ui/theme.css';
import { createApp } from 'vue';
import App from './App.vue';
import { createServices, provideServices } from './app/services';
import { startDemo } from './dev/services';
import { createAppI18n, pickLanguage } from './i18n';
import { createAppRouter } from './router';

// No async bootstrap (spec 5.1): the app state loads inside the frame.
const language = pickLanguage(navigator.languages);
// Demo mode is the default of `npm run dev` (spec 13.6); `--mode real` and every production build use the real systems.
// The condition must stay literal here: Vite replaces it with `false` in a build, which drops `dev/` from the bundle.
// On the dev server (real mode) there is no backend login: it covers the ChurchTools side only.
const services =
    import.meta.env.DEV && import.meta.env.MODE !== 'real' ? startDemo(language) : createServices(language, { backendLogin: !import.meta.env.DEV });
const app = createApp(App).use(createAppI18n(services.language)).use(createAppRouter());
provideServices(services, app);
app.mount('#app');
