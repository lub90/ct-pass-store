import './ui/theme.css';
import { createApp } from 'vue';
import App from './App.vue';
import { createAppI18n, pickLanguage } from './i18n';
import { router } from './router';

const i18n = createAppI18n(pickLanguage(navigator.languages));

createApp(App).use(i18n).use(router).mount('#app');
