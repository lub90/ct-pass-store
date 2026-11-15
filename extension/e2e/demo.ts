/**
 * Helpers for the browser tests: they run against the demo mode of `npm run dev` only (invented data of
 * `src/dev/demo-data.ts`, in-memory ChurchTools and backend). Every test gets a fresh browser context, so a fresh
 * demo state.
 */
import { expect, type Page } from '@playwright/test';

export type Scenario = 'user' | 'admin' | 'setup-needed' | 'no-access' | 'churchtools-error' | 'version-mismatch';

/** `localStorage` key of the demo state (`DEMO_STORAGE_KEY`). */
const DEMO_STORAGE_KEY = 'cps-demo-state';

/** The demo's ChurchTools password (`DEMO_CT_PASSWORD`). */
export const DEMO_CT_PASSWORD = 'demo-passwort';

/** Invented demo people (`DEMO_SEED.persons`). */
export const CLARA = { id: 9003, name: 'Clara Erfundenreich' };
export const ADA = { id: 9001, name: 'Ada Beispielmann' };

/**
 * Starts the demo in `scenario` and opens `path` (relative to `/ccm/ctpassstore/`). The scenario is written before
 * the app's first script runs and only if nothing is kept yet, so a reload keeps what the test did.
 */
export async function openDemo(page: Page, scenario: Scenario, path = './'): Promise<void> {
    await page.addInitScript(
        ([key, s]) => {
            try {
                if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ scenario: s }));
            } catch {
                // No storage: the demo starts as user.
            }
        },
        [DEMO_STORAGE_KEY, scenario] as const,
    );
    await page.goto(path);
    await settled(page);
}

/** The app has left its loading state. */
export async function settled(page: Page): Promise<void> {
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByText('Lädt …')).toHaveCount(0);
}

/** The demo switch is not part of the app; it is hidden where it would cover the page (screenshots, hit tests). */
export async function hideDemoSwitch(page: Page): Promise<void> {
    await page.addStyleTag({ content: 'aside[aria-label="Demo-Modus"] { display: none !important; }' });
}

/** Every route of spec 4.1 with a page, and who sees it. */
export const ROUTES: { path: string; scenario: Scenario }[] = [
    { path: './', scenario: 'user' },
    { path: 'about', scenario: 'user' },
    { path: 'does-not-exist', scenario: 'user' },
    { path: './', scenario: 'admin' },
    { path: 'manage', scenario: 'admin' },
    { path: `manage/${CLARA.id}`, scenario: 'admin' },
    { path: 'settings', scenario: 'admin' },
    { path: 'settings/rules', scenario: 'admin' },
    { path: 'settings/texts', scenario: 'admin' },
    { path: 'settings/access', scenario: 'admin' },
    { path: 'settings/access/clients/new', scenario: 'admin' },
    { path: 'settings/access/clients/demo-lesezugriff', scenario: 'admin' },
    { path: 'settings/backend', scenario: 'admin' },
    { path: 'settings/backup', scenario: 'admin' },
    { path: 'settings/setup', scenario: 'admin' },
    { path: 'about', scenario: 'admin' },
    { path: 'settings', scenario: 'user' },
    { path: './', scenario: 'setup-needed' },
    { path: './', scenario: 'no-access' },
    { path: './', scenario: 'churchtools-error' },
    { path: './', scenario: 'version-mismatch' },
];
