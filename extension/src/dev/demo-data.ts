/**
 * Invented demo data for `npm run dev` (spec 13.6): no real people, no real instance, no real secrets. Names and ids
 * are made up; the backend address uses the reserved `.invalid` domain; the machine client's key is the bytes 1 to 32,
 * an obviously fake but well-formed Ed25519 key.
 *
 * Plain data only (no imports at run time, no calls at the top level): `scripts/check-dist.js` imports this file with
 * Node to read `DEMO_STRINGS`, and a production build must be able to drop it whole.
 */
import type { Permissions } from '../ct/types';

/** Invented ChurchTools person ids of the demo admin and user. */
export const DEMO_ADMIN_ID = 9001;
export const DEMO_USER_ID = 9002;

export const DEMO_MODULE_ID = 9000;
export const DEMO_SETTINGS_CATEGORY = 9011;
export const DEMO_ACCESS_CATEGORY = 9012;

export const DEMO_BACKEND_URL = 'https://passwoerter.demo.invalid';
export const DEMO_OAUTH_CLIENT = 'demo-oauth-client';
/** The ChurchTools password every demo person „has“ (the fake backend asks for it before a change). */
export const DEMO_CT_PASSWORD = 'demo-passwort';
/** Where the demo keeps its state (`localStorage`, development only). */
export const DEMO_STORAGE_KEY = 'cps-demo-state';

const GROUPS = { users: 9101, admins: 9102, service: 9103 } as const;

/** The demo world. `marker` carries the demo marker (spec 13.5); everything else is what the fakes start with. */
export const DEMO_SEED = {
    marker: '__DEMO__',
    persons: [
        { id: DEMO_ADMIN_ID, firstName: 'Ada', lastName: 'Beispielmann' },
        { id: DEMO_USER_ID, firstName: 'Bruno', lastName: 'Platzhalterberg' },
        { id: 9003, firstName: 'Clara', lastName: 'Erfundenreich' },
        { id: 9004, firstName: 'Dario', lastName: 'Fiktivo' },
        { id: 9005, firstName: 'Edda', lastName: 'Ausgedachtova', archived: true },
    ],
    groups: [
        { id: GROUPS.users, name: 'Demo-Gruppe Passwortnutzer', memberIds: [DEMO_ADMIN_ID, DEMO_USER_ID, 9003, 9004, 9005] },
        { id: GROUPS.admins, name: 'Demo-Gruppe Passwortadmins', memberIds: [DEMO_ADMIN_ID] },
        { id: GROUPS.service, name: 'Demo-Gruppe Dienstkonto', memberIds: [] },
    ],
    categories: [
        { id: DEMO_SETTINGS_CATEGORY, name: 'settings', shorty: 'settings' },
        { id: DEMO_ACCESS_CATEGORY, name: 'access', shorty: 'access' },
    ],
    settings: {
        schema: 2,
        revision: 1,
        requirePasswordForPasswordChange: true,
        allowCustomPassword: true,
        passwordLength: 16,
        backendUrl: DEMO_BACKEND_URL,
        oauthClientId: DEMO_OAUTH_CLIENT,
    },
    access: {
        schema: 2,
        revision: 1,
        groups: {
            users: { groupId: GROUPS.users, createdBySetup: true },
            admins: { groupId: GROUPS.admins, createdBySetup: true },
            service: { groupId: GROUPS.service, createdBySetup: true },
        },
        machineClients: [
            {
                id: 'demo-lesezugriff',
                name: 'Demo-Lesezugriff',
                publicKeys: ['AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA='],
                permissions: ['entries:read'],
                createdAt: '2026-01-01',
            },
        ],
    },
    /** Stored passwords by person id (invented). */
    entries: { [DEMO_ADMIN_ID]: 'Demo-Kennwort-ada-1!' } as Record<number, string>,
    backendVersion: '0.1.0',
};

/** What the demo person may do: the admin everything on both categories, the user only read the settings. */
export const DEMO_PERMISSIONS: { admin: Permissions; user: Permissions } = {
    admin: {
        view: true,
        'create custom category': true,
        'view custom category': [DEMO_SETTINGS_CATEGORY, DEMO_ACCESS_CATEGORY],
        'edit custom category': [],
        'delete custom category': [],
        'view custom data': [DEMO_SETTINGS_CATEGORY, DEMO_ACCESS_CATEGORY],
        'create custom data': [DEMO_SETTINGS_CATEGORY, DEMO_ACCESS_CATEGORY],
        'edit custom data': [DEMO_SETTINGS_CATEGORY, DEMO_ACCESS_CATEGORY],
        'delete custom data': [DEMO_SETTINGS_CATEGORY, DEMO_ACCESS_CATEGORY],
    },
    user: {
        view: true,
        'create custom category': false,
        'view custom category': [DEMO_SETTINGS_CATEGORY],
        'edit custom category': [],
        'delete custom category': [],
        'view custom data': [DEMO_SETTINGS_CATEGORY],
        'create custom data': [],
        'edit custom data': [],
        'delete custom data': [],
    },
};

/** The groups the demo admin has the „view group“ right on. */
export const DEMO_ADMIN_VIEW_GROUPS: number[] = [GROUPS.users, GROUPS.admins, GROUPS.service];

/**
 * Texts of the demo data that must never appear in a production build (`check-dist`). `demo-data.test.ts` checks
 * that every name of the seed is listed here.
 */
export const DEMO_STRINGS: string[] = [
    'Beispielmann',
    'Platzhalterberg',
    'Erfundenreich',
    'Fiktivo',
    'Ausgedachtova',
    'Demo-Gruppe',
    'Demo-Lesezugriff',
    'demo-lesezugriff',
    'Demo-Kennwort',
    'demo.invalid',
    DEMO_OAUTH_CLIENT,
    DEMO_CT_PASSWORD,
    DEMO_STORAGE_KEY,
    'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
];
