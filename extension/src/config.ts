/** Key of the extension in ChurchTools; part of the served path `/ccm/<key>/`. */
export const EXTENSION_KEY = 'ctpassstore';
/** Base path the app is served under (history routing, assets). */
export const BASE_PATH: string = import.meta.env.BASE_URL;
/** `x.y.z` for a release, `x.y.z+sha[-dirty]` otherwise. */
export const APP_VERSION: string = __APP_VERSION__;
/** OAuth redirect path below `BASE_PATH`. */
export const CALLBACK_PATH = 'auth/callback';
