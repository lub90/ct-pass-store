/**
 * The systems the app talks to (spec 5.1 rule 3), injected so that tests and the demo mode can replace them. `main.ts`
 * provides the real ones; app tests mount with fakes.
 */
import { inject, provide, type App, type InjectionKey } from 'vue';
import { createBackendApi, type BackendApi } from '../backend/api';
import { Auth } from '../backend/auth';
import { EXTENSION_KEY } from '../config';
import { createCtApi, type CtApi } from '../ct/api';
import type { Language } from '../i18n';
import type { Session } from './useSession';
import { ChurchToolsKv } from '../store/churchtools-kv';
import { ExtensionStore } from '../store/repository';

export interface Services {
    ct: CtApi;
    store: ExtensionStore;
    auth: Auth;
    /** The backend API for an address (`settings.backendUrl`), with the current token. */
    backend: (baseUrl: string) => BackendApi;
    language: Language;
    /** The extension's own version; `APP_VERSION` when left out (tests pass their own). */
    appVersion?: string;
    /** The session of the app; made by `App.vue` when left out (tests pass their own to drive it). */
    session?: Session;
}

export const SERVICES_KEY: InjectionKey<Services> = Symbol('services');

/** Inside a component's setup, or for the whole app when `app` is given (`main.ts`). */
export function provideServices(services: Services, app?: App): void {
    if (app) app.provide(SERVICES_KEY, services);
    else provide(SERVICES_KEY, services);
}

export function useServices(): Services {
    const services = inject(SERVICES_KEY, null);
    if (!services) throw new Error('No services provided');
    return services;
}

/** The backend API for an address; it carries the token only when the address is the configured backend. */
export function backendFor(auth: Pick<Auth, 'tokenFor'>): (baseUrl: string) => BackendApi {
    return (baseUrl) => createBackendApi(baseUrl, () => auth.tokenFor(baseUrl));
}

/** The real systems: ChurchTools of the page, its KV store, and the backend from the settings. */
export function createServices(language: Language): Services {
    const ct = createCtApi();
    const backend = (baseUrl: string): BackendApi => backendFor(auth)(baseUrl);
    const auth: Auth = new Auth(backend);
    return { ct, store: new ExtensionStore(new ChurchToolsKv(ct, EXTENSION_KEY)), auth, backend, language };
}
