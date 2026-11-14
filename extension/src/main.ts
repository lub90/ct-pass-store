import './ui/theme.css';
import { createApp } from 'vue';
import App from './App.vue';
import { createServices, provideServices } from './app/services';
import { createAppI18n, pickLanguage } from './i18n';
import { createAppRouter } from './router';

// No async bootstrap (spec 5.1): the app state loads inside the frame.
const services = createServices(pickLanguage(navigator.languages));
const app = createApp(App).use(createAppI18n(services.language)).use(createAppRouter());
provideServices(services, app);
app.mount('#app');
