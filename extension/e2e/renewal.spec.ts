/**
 * Session renewal through the popup (spec 7.2) in a real browser. A popup needs a user activation (a click), and it
 * lasts only a few seconds; these tests show that the app's real `Auth` and `Session` open the popup from a click, also
 * when the request that needs it is sent after a click on the confirm dialog's button.
 *
 * The demo's own `Auth` has no OAuth (its popup is always "blocked"), so the first tests build a real `Auth` and
 * `Session` from the app's modules on the demo page (Vite serves them under `/ccm/ctpassstore/src/`), with a stand-in
 * backend login. `/oauth/authorize` is answered by the test with a redirect to the app's callback route, so the popup
 * runs the real callback page, which posts the code back to its opener. Nothing leaves the machine.
 *
 * Timing: `page.evaluate` counts as a user activation in Chromium, so every test waits longer than its activation
 * lifetime (5 s in Chromium) before the click that matters; the control test shows that a renewal after the same wait
 * but without a click is blocked (Chromium's popup blocker is on in `playwright.config.ts`).
 */
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './demo';

/** Longer than Chromium's transient activation (5 s): whatever activation came before has expired. */
const ACTIVATION_EXPIRED_MS = 5500;
const PERSON = 4711;

interface Harness {
    results: string[];
    logins: number;
    expiresInMs(): number;
}
declare global {
    interface Window {
        e2e: Harness & Record<string, unknown>;
    }
}

/** Answers the popup's `/oauth/authorize` like ChurchTools would after a login: back to the callback with a code. */
async function fakeAuthorize(page: Page): Promise<void> {
    await page.context().route('**/oauth/authorize?**', async (route) => {
        const url = new URL(route.request().url());
        const back = new URL(url.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'e2e-code');
        back.searchParams.set('state', url.searchParams.get('state')!);
        await route.fulfill({ status: 302, headers: { location: back.href } });
    });
}

/**
 * A real `Auth` (browser env: real `window.open`, `postMessage`, `sessionStorage`) and `Session`, configured for an
 * invented backend, with a token that expires in `expiresInMs`. The login answers with a fresh token for the same
 * person.
 */
async function installHarness(page: Page, expiresInMs: number): Promise<void> {
    await page.evaluate(
        async ({ expiresInMs, person }) => {
            const src = '/ccm/ctpassstore/src/';
            const { Auth, TOKEN_KEY, windowEnv } = await import(/* @vite-ignore */ `${src}backend/auth.ts`);
            const { backendBase } = await import(/* @vite-ignore */ `${src}backend/http.ts`);
            const { createSession } = await import(/* @vite-ignore */ `${src}app/useSession.ts`);
            const backendUrl = 'https://backend.e2e.invalid';
            const part = (x: unknown) => btoa(JSON.stringify(x)).replace(/=+$/, '');
            const jwt = `${part({ alg: 'none' })}.${part({ sub: String(person) })}.x`;
            sessionStorage.setItem(
                TOKEN_KEY,
                JSON.stringify({
                    accessToken: jwt,
                    expiresAt: Date.now() + expiresInMs,
                    admin: false,
                    version: '0.1.0',
                    backend: backendBase(backendUrl),
                    person,
                }),
            );
            const harness = { results: [] as string[], logins: 0 } as Window['e2e'];
            const auth = new Auth(
                () => ({
                    login: async (code: string) => {
                        if (code !== 'e2e-code') throw new Error(`unexpected code ${code}`);
                        harness.logins++;
                        return { accessToken: jwt, expiresIn: 3600, admin: false, version: '0.1.0' };
                    },
                }),
                { ...windowEnv(), instanceBaseUrl: window.location.origin },
            );
            auth.configure({ backendUrl, clientId: 'e2e-client' });
            auth.bindPerson(person);
            harness.expiresInMs = () => auth.expiresInMs();
            harness.session = createSession(auth, () => '/');
            window.e2e = harness;
        },
        { expiresInMs, person: PERSON },
    );
}

/** A button outside the app whose click runs `action` (a function body using `e2e`), recording how it ended. */
async function addButton(page: Page, id: string, action: string): Promise<void> {
    await page.evaluate(
        ({ id, action }) => {
            const run = new Function('e2e', `return (async () => { ${action} })();`) as (h: Window['e2e']) => Promise<string>;
            const button = document.createElement('button');
            button.id = id;
            button.textContent = id;
            Object.assign(button.style, { position: 'fixed', top: '0', left: '0', zIndex: '3000', minHeight: '44px' });
            button.addEventListener('click', () => {
                run(window.e2e).then(
                    (r) => window.e2e.results.push(r),
                    (e: Error) => window.e2e.results.push(e.name),
                );
            });
            document.body.append(button);
        },
        { id, action },
    );
}

const results = (page: Page) => page.evaluate(() => window.e2e.results);

test.describe('renewal popup', () => {
    test.beforeEach(async ({ page }) => {
        await openDemo(page, 'user');
        await fakeAuthorize(page);
    });

    test('a click on a button that renews first opens the popup, and the login completes', async ({ page }) => {
        // 60 s left: ensureFresh() renews (spec 7.2: fewer than 2 minutes).
        await installHarness(page, 60_000);
        await addButton(page, 'e2e-fresh', "await e2e.session.ensureFresh(); return 'fresh';");
        await page.waitForTimeout(ACTIVATION_EXPIRED_MS);

        const popup = page.waitForEvent('popup');
        await page.locator('#e2e-fresh').click();
        await popup;
        await expect.poll(() => results(page)).toEqual(['fresh']);
        expect(await page.evaluate(() => window.e2e.logins)).toBe(1);
        expect(await page.evaluate(() => window.e2e.expiresInMs())).toBeGreaterThan(50 * 60_000);
    });

    test('the click on the confirm dialog carries the popup of a renewal after token-expired', async ({ page }) => {
        // Plenty of time left: only the backend's 401 token-expired (after the confirm) asks for the renewal.
        await installHarness(page, 60 * 60_000);
        await page.evaluate(async () => {
            // The same module instance as the app's: its ConfirmDialog draws the question.
            const src = '/ccm/ctpassstore/src/';
            const { useConfirm } = await import(/* @vite-ignore */ `${src}ui/useConfirm.ts`);
            const { BackendProblem } = await import(/* @vite-ignore */ `${src}backend/problems.ts`);
            const e2e = window.e2e;
            let sends = 0;
            // As in PasswordFlow / ManageView: confirm, then the request; it answers token-expired once.
            void useConfirm()({ title: 'E2E-Frage', text: 'Weiter?', confirmLabel: 'Fortfahren', cancelLabel: 'Abbrechen' })
                .then(async (answer: { confirmed: boolean }) => {
                    if (!answer.confirmed) return 'cancelled';
                    // The request's round trip before the 401.
                    await new Promise((r) => setTimeout(r, 300));
                    return (e2e.session as { call<T>(fn: () => Promise<T>): Promise<T> }).call(async () => {
                        sends++;
                        if (sends === 1) throw new BackendProblem('token-expired', 401);
                        return `sent ${sends}`;
                    });
                })
                .then(
                    (r: string) => e2e.results.push(r),
                    (e: Error) => e2e.results.push(e.name),
                );
        });
        const dialog = page.getByRole('alertdialog', { name: 'E2E-Frage' });
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(ACTIVATION_EXPIRED_MS);

        const popup = page.waitForEvent('popup');
        await dialog.getByRole('button', { name: 'Fortfahren' }).click();
        await popup;
        await expect.poll(() => results(page)).toEqual(['sent 2']);
        expect(await page.evaluate(() => window.e2e.logins)).toBe(1);
    });

    test('control: the same renewal without a click is blocked', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', "the popup blocker is switched on for Chromium only; WebKit's default is not known here");
        await installHarness(page, 60_000);
        let popups = 0;
        page.on('popup', () => popups++);
        // Started from a timer after the evaluate's activation has run out: no user activation.
        await page.evaluate((ms) => {
            setTimeout(() => {
                void (window.e2e.session as { ensureFresh(): Promise<void> }).ensureFresh().then(
                    () => window.e2e.results.push('fresh'),
                    (e: Error) => window.e2e.results.push(e.name),
                );
            }, ms);
        }, ACTIVATION_EXPIRED_MS);
        // No polling meanwhile: each `evaluate` would be a new activation.
        await page.waitForTimeout(ACTIVATION_EXPIRED_MS + 1500);
        expect(await results(page)).toEqual(['PopupBlocked']);
        expect(popups).toBe(0);
        expect(await page.evaluate(() => (window.e2e.session as { needsRenewal: { value: boolean } }).needsRenewal.value)).toBe(true);
    });
});

test.describe('renewal in the app (demo)', () => {
    test('a token near its end is renewed from the click; the demo reports the popup blocked and keeps the input', async ({ page }) => {
        await page.clock.install();
        await openDemo(page, 'user');
        await page.getByRole('button', { name: 'Passwort festlegen' }).click();
        await page.getByRole('radio', { name: 'Selbst wählen' }).check();
        await page.getByLabel('Neues Passwort', { exact: true }).fill('Ein-Demo-Passwort-42');
        await page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill('demo-passwort');

        // The demo token lasts 24 h; one minute before its end the submit click renews first (spec 7.2).
        await page.clock.fastForward('23:59:00');
        await page.getByRole('button', { name: 'Passwort speichern' }).click();
        const banner = page.getByText('Deine Sitzung ist abgelaufen.', { exact: false });
        await expect(banner).toBeVisible();
        // Nothing was sent and nothing typed is lost.
        await expect(page.getByText('✓ Gespeichert')).toHaveCount(0);
        await expect(page.getByLabel('Neues Passwort', { exact: true })).toHaveValue('Ein-Demo-Passwort-42');
        await expect(page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)')).toHaveValue('demo-passwort');

        // „Sitzung erneuern“ tries again from its click; the demo has no OAuth, so the banner stays.
        await page.getByRole('button', { name: 'Sitzung erneuern' }).click();
        await expect(banner).toBeVisible();
    });
});
