import type { Person } from './ct-types';
import './style.css';
import { churchtoolsClient } from '@churchtools/churchtools-client';

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

const user = await churchtoolsClient.get<Person>(`/whoami`);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div style="display: flex; place-content: center; place-items: center; height: 100vh;">
    <h1>Welcome ${[user.firstName, user.lastName].join(' ')}</h1>
  </div>
`;
