/**
 * Native keyboard and pointer behavior jsdom can't show (ledger rulings for Task 3): the Toggle on „Passwortregeln“.
 * The ChoiceCard arrow keys are in `password.spec.ts`.
 */
import { expect, test } from '@playwright/test';
import { openDemo } from './demo';

const LABEL = 'Eigene Passwörter erlauben';

test('Space and Enter flip the Toggle', async ({ page }) => {
    await openDemo(page, 'admin', 'settings/rules');
    const toggle = page.getByRole('switch', { name: LABEL });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // The change reached the form: it is dirty after one flip.
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();
});

test('a click on the Toggle text flips it once and puts the focus on the switch', async ({ page }) => {
    await openDemo(page, 'admin', 'settings/rules');
    const toggle = page.getByRole('switch', { name: LABEL });
    await page.getByText(LABEL, { exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeFocused();
    await page.getByText('Sonst werden Passwörter nur zufällig erzeugt.').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle).toBeFocused();
});

test('a tap on the Toggle text flips it once', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch projects only');
    await openDemo(page, 'admin', 'settings/rules');
    const toggle = page.getByRole('switch', { name: LABEL });
    await page.getByText(LABEL, { exact: true }).tap();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
});
