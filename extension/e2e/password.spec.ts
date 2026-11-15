/** „Mein Passwort“ (spec 4.2) in a real browser: generate, copy, done; the ChoiceCard group and the custom form. */
import { expect, test } from '@playwright/test';
import { DEMO_CT_PASSWORD, openDemo } from './demo';

test('a user generates a password, copies it and is done', async ({ page, browserName }) => {
    await openDemo(page, 'user');
    await expect(page.getByText('Noch kein Passwort')).toBeVisible();

    await page.getByRole('button', { name: 'Passwort festlegen' }).click();
    await expect(page.getByRole('radio', { name: /Zufällig erzeugen/ })).toBeChecked();
    const submit = page.getByRole('button', { name: 'Passwort erzeugen' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill(DEMO_CT_PASSWORD);
    await submit.click();

    await expect(page.getByText('✓ Gespeichert')).toBeVisible();
    await expect(page.getByText('Du siehst es nur jetzt.', { exact: false })).toBeVisible();
    const result = page.getByLabel('Dein neues Passwort');
    // passwordLength 16 in the demo settings, only characters the rules allow.
    const generated = await result.inputValue();
    expect(generated).toMatch(/^[A-Za-z0-9!@$%&*\-_+=?.]{16}$/);

    await page.getByRole('button', { name: 'Kopieren' }).click();
    await expect(page.getByRole('button', { name: 'Kopiert' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Kopiert' })).toBeVisible();
    if (browserName === 'chromium') {
        // Chromium grants the clipboard permission to the test (config); WebKit has no such permission to grant.
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated);
    }
    // The feedback goes back after 2 s.
    await expect(page.getByRole('button', { name: 'Kopieren' })).toBeVisible({ timeout: 4000 });

    await page.getByRole('button', { name: 'Fertig' }).click();
    await expect(page.getByText('✓ Passwort ist gesetzt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neues Passwort festlegen' })).toBeVisible();
    // The plaintext is gone from the page.
    expect(await page.content()).not.toContain(generated);
});

test('the ChoiceCard group moves its selection with the arrow keys', async ({ page }) => {
    await openDemo(page, 'user');
    await page.getByRole('button', { name: 'Passwort festlegen' }).click();
    const generate = page.getByRole('radio', { name: /Zufällig erzeugen/ });
    const custom = page.getByRole('radio', { name: 'Selbst wählen' });
    await generate.focus();
    await page.keyboard.press('ArrowDown');
    await expect(custom).toBeChecked();
    await expect(custom).toBeFocused();
    // The chosen card shows the custom field (the selection reached the model, not only the radio).
    await expect(page.getByLabel('Neues Passwort', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect(generate).toBeChecked();
    await expect(page.getByLabel('Neues Passwort', { exact: true })).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(custom).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(generate).toBeChecked();
});

test('a user saves a chosen password; the form invites no username', async ({ page }) => {
    await openDemo(page, 'user');
    await page.getByRole('button', { name: 'Passwort festlegen' }).click();
    await page.getByRole('radio', { name: 'Selbst wählen' }).check();

    const form = page.locator('form.cps-flow');
    const field = page.getByLabel('Neues Passwort', { exact: true });
    const primary = page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)');
    // Password-manager heuristic (security review of Task 12): the new password is marked as new, the ChurchTools
    // password as current; no text field in the form a manager would take as the username.
    await expect(field).toHaveAttribute('autocomplete', 'new-password');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(primary).toHaveAttribute('autocomplete', 'current-password');
    expect(await form.locator('input:not([type=password]):not([type=radio]):not([type=hidden])').count()).toBe(0);
    expect(await form.locator('input[autocomplete~=username], input[autocomplete~=email]').count()).toBe(0);

    await field.fill('Ein-Demo-Passwort-42');
    await expect(page.locator('[data-rule]:not([data-state=ok])')).toHaveCount(0);
    await primary.fill(DEMO_CT_PASSWORD);
    await page.getByRole('button', { name: 'Passwort speichern' }).click();
    await expect(page.getByText('✓ Gespeichert')).toBeVisible();
    await expect(page.getByText('✓ Passwort ist gesetzt')).toBeVisible();
});
