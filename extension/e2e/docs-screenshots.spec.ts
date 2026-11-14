/**
 * The screenshots of the user guide, written to `docs/images/`: demo mode only (invented people and addresses), a
 * fixed scenario per picture, no time stamps or versions in the picture, and a fixed example in place of the randomly
 * generated password. Desktop pictures from `chromium-desktop`, phone pictures from `chromium-phone`; the other
 * projects skip this file.
 *
 * Opt-in: only with `CPS_SCREENSHOTS=1` (`npm run docs:screenshots`), so a normal browser test run never rewrites
 * `docs/images/`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { CLARA, DEMO_CT_PASSWORD, hideDemoSwitch, openDemo, type Scenario } from './demo';

const IMAGES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images');
/** Invented, follows the demo rules (16 characters), shown instead of the random one. */
const EXAMPLE_PASSWORD = 'Beispiel-Pw-42!x';

const kind = () => (test.info().project.name === 'chromium-phone' ? 'phone' : 'desktop');

test.beforeEach(() => {
    test.skip(process.env.CPS_SCREENSHOTS !== '1', 'screenshots only with CPS_SCREENSHOTS=1 (npm run docs:screenshots)');
    const project = test.info().project.name;
    test.skip(project !== 'chromium-desktop' && project !== 'chromium-phone', 'screenshots come from Chromium only');
});

async function start(page: Page, scenario: Scenario, route = './'): Promise<void> {
    await openDemo(page, scenario, route);
    await hideDemoSwitch(page);
}

async function shot(page: Page, name: string): Promise<void> {
    // The caret, focus rings and hover styles would make pictures differ between runs.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(IMAGES, `${name}-${kind()}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
}

/** Replaces the generated password on screen (only in the picture: the field is read-only anyway). */
async function exampleResult(page: Page): Promise<void> {
    const field = page.getByLabel('Dein neues Passwort');
    await expect(field).toHaveValue(/.{16}/);
    await field.evaluate((input, value) => ((input as HTMLInputElement).value = value), EXAMPLE_PASSWORD);
}

async function generate(page: Page): Promise<void> {
    await page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill(DEMO_CT_PASSWORD);
    await page.getByRole('button', { name: 'Passwort erzeugen' }).click();
    await exampleResult(page);
}

test('Mein Passwort: overview, form and result', async ({ page }) => {
    await start(page, 'user');
    await expect(page.getByText('Noch kein Passwort')).toBeVisible();
    await shot(page, 'password-overview');

    await page.getByRole('button', { name: 'Passwort festlegen' }).click();
    await shot(page, 'password-choose');

    await page.getByRole('radio', { name: 'Selbst wählen' }).check();
    await page.getByLabel('Neues Passwort', { exact: true }).fill('Demo-Passwort-7');
    await shot(page, 'password-custom');

    await page.getByRole('radio', { name: /Zufällig erzeugen/ }).check();
    await generate(page);
    await shot(page, 'password-result');
});

test('Passwörter verwalten: a person, the banner and the confirm dialog', async ({ page }) => {
    await start(page, 'admin', `manage/${CLARA.id}`);
    await expect(page.getByText('Noch kein Passwort')).toBeVisible();
    await shot(page, 'manage-person');

    await page.getByRole('button', { name: 'Neues Passwort' }).click();
    await generate(page);
    await page.getByRole('button', { name: 'Fertig' }).click();
    await page.getByRole('button', { name: 'Neues Passwort' }).click();
    await shot(page, 'manage-flow');

    await page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill(DEMO_CT_PASSWORD);
    await page.getByRole('button', { name: 'Passwort erzeugen' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await shot(page, 'manage-confirm');
});

test('Einstellungen: overview, rules and access', async ({ page }) => {
    await start(page, 'admin', 'settings');
    await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
    await shot(page, 'settings-overview');

    await page.goto('settings/rules');
    await hideDemoSwitch(page);
    await expect(page.getByRole('switch').first()).toBeVisible();
    await shot(page, 'settings-rules');

    await page.goto('settings/access');
    await hideDemoSwitch(page);
    await expect(page.getByRole('heading', { name: 'Maschinen-Clients' })).toBeVisible();
    await shot(page, 'settings-access');
});
