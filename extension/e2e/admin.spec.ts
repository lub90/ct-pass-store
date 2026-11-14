/**
 * „Passwörter verwalten“ (spec 4.3) in a real browser: an admin sets someone else's password (warning banner, the
 * confirm dialog naming the person and the „ID n“ line), and the dialog's focus behavior (spec 9.4).
 */
import { expect, test, type Page } from '@playwright/test';
import { CLARA, DEMO_CT_PASSWORD, openDemo } from './demo';

async function pickClara(page: Page): Promise<void> {
    const search = page.getByRole('combobox', { name: 'Person aus der Nutzergruppe suchen' });
    await search.fill('Clara');
    const option = page.getByRole('option', { name: new RegExp(CLARA.name) });
    await expect(option).toContainText(`ID ${CLARA.id}`);
    await option.click();
    await expect(page).toHaveURL(new RegExp(`/manage/${CLARA.id}$`));
}

/** Generates a password for the selected person and returns to the overview with „Fertig“. */
async function generateFor(page: Page): Promise<void> {
    await page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill(DEMO_CT_PASSWORD);
    await page.getByRole('button', { name: 'Passwort erzeugen' }).click();
}

test('an admin sets the password of someone else: banner, then a confirm dialog naming the person', async ({ page }) => {
    await openDemo(page, 'admin', 'manage');
    await pickClara(page);
    await expect(page.getByText('Noch kein Passwort')).toBeVisible();

    // First password: no dialog (nothing is replaced), but the banner names the person.
    await page.getByRole('button', { name: 'Neues Passwort' }).click();
    await expect(page.getByText(`Du legst gerade das Passwort für ${CLARA.name} fest.`)).toBeVisible();
    await generateFor(page);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByLabel('Dein neues Passwort')).toHaveValue(/^.{16}$/);
    await page.getByRole('button', { name: 'Fertig' }).click();
    await expect(page.getByText('✓ Passwort ist gesetzt')).toBeVisible();

    // Second password: the old one stops working, so the admin confirms first.
    await page.getByRole('button', { name: 'Neues Passwort' }).click();
    await generateFor(page);
    const dialog = page.getByRole('alertdialog', { name: 'Passwort ersetzen?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('bdi').first()).toHaveText(CLARA.name);
    await expect(dialog.locator('bdi').nth(1)).toHaveText(`ID ${CLARA.id}`);
    await expect(dialog).toHaveAccessibleDescription(
        `${CLARA.name} ID ${CLARA.id} Das bisherige Passwort von ${CLARA.name} funktioniert danach nicht mehr. Fortfahren?`,
    );
    await expect(dialog.getByRole('button', { name: 'Fortfahren' })).toBeFocused();

    // Escape: nothing is sent, the form stays, and the focus is back on the button (disabled while the dialog was open).
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const submit = page.getByRole('button', { name: 'Passwort erzeugen' });
    await expect(submit).toBeFocused();
    await expect(page.getByLabel('Dein neues Passwort')).toHaveCount(0);

    await submit.click();
    await dialog.getByRole('button', { name: 'Fortfahren' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Dein neues Passwort')).toHaveValue(/^.{16}$/);
});

test('the dialog traps the focus, Escape cancels, and the focus returns to the opener', async ({ page }) => {
    await openDemo(page, 'admin', `manage/${CLARA.id}`);
    // Ada's demo entry exists; Clara gets one first so „Löschen“ has something to delete.
    await page.getByRole('button', { name: 'Neues Passwort' }).click();
    await generateFor(page);
    await page.getByRole('button', { name: 'Fertig' }).click();
    await expect(page.getByText('✓ Passwort ist gesetzt')).toBeVisible();

    const opener = page.getByRole('button', { name: 'Löschen' });
    await opener.click();
    const dialog = page.getByRole('alertdialog', { name: 'Passwort löschen?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Danger: the focus starts on „Abbrechen“.
    const cancel = dialog.getByRole('button', { name: 'Abbrechen' });
    await expect(cancel).toBeFocused();

    // Tab and Shift+Tab never leave the dialog, however often.
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role=alertdialog]'));
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Shift+Tab');
        expect(await inside()).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    // Cancelled: nothing was deleted.
    await expect(page.getByText('✓ Passwort ist gesetzt')).toBeVisible();

    // Confirmed with the password typed in the dialog: deleted.
    await opener.click();
    await dialog.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill(DEMO_CT_PASSWORD);
    await dialog.getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByText('✓ Gelöscht')).toBeVisible();
    await expect(page.getByText('Noch kein Passwort')).toBeVisible();
});

test('the dialog covers the whole page and sits above everything; the app has one main landmark', async ({ page }) => {
    await openDemo(page, 'admin', `manage/${CLARA.id}`);
    await expect(page.getByRole('main')).toHaveCount(1);

    await page.getByRole('button', { name: 'Neues Passwort' }).click();
    await generateFor(page);
    await page.getByRole('button', { name: 'Fertig' }).click();
    await page.getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();

    // Stand-in for ChurchTools' top bar (z-index 1040 in its own fixed layer): the dialog must still be on top.
    await page.evaluate(() => {
        const bar = document.createElement('div');
        bar.id = 'e2e-host-topbar';
        Object.assign(bar.style, { position: 'fixed', top: '0', left: '0', right: '0', height: '60px', zIndex: '1040', background: 'red' });
        document.body.append(bar);
    });
    const hits = await page.evaluate(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const points = [
            [w / 2, 10],
            [5, 5],
            [w - 5, h - 5],
            [w / 2, h / 2],
        ];
        return points.map(([x, y]) => {
            const el = document.elementFromPoint(x!, y!);
            return !!el?.closest('.cps-confirm');
        });
    });
    expect(hits).toEqual([true, true, true, true]);
    // Still one main: the dialog's layer is no landmark of its own.
    await expect(page.getByRole('main')).toHaveCount(1);
});
