/**
 * Browser tests (spec 13.1): the demo mode of `npm run dev` (invented data, no request leaves the browser) in Chromium
 * and WebKit, at desktop width and at 375 px with touch. Run by hand with `npm run test:browser`; not part of
 * `npm run check`, since it needs the Playwright browsers (`docs/development.md`).
 */
import { execFileSync } from 'node:child_process';
import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * A free port for the dev server, chosen once by the runner and handed to its workers through the environment (they
 * load this file again). `CPS_E2E_PORT` set by hand wins.
 */
function freePort(): string {
    const script =
        "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})";
    return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim();
}
process.env.CPS_E2E_PORT ??= freePort();
const port = process.env.CPS_E2E_PORT;
const origin = `http://127.0.0.1:${port}`;

const desktop = { viewport: { width: 1280, height: 800 } };
/** 375 px like a small phone, with touch: `(pointer: coarse)` rules apply (44 px targets). */
const phone = { viewport: { width: 375, height: 740 }, hasTouch: true };

/**
 * Chromium: clipboard permission for the copy test, and the popup blocker on (Playwright turns it off by default), so a
 * renewal popup outside a click is blocked as in a normal browser.
 */
const chromium = {
    // The full Chromium in its new headless mode: the old headless shell has no popup blocker.
    channel: 'chromium',
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: { ignoreDefaultArgs: ['--disable-popup-blocking'] },
};

const projects: Project[] = [
    {
        name: 'chromium-desktop',
        use: { ...devices['Desktop Chrome'], ...desktop, ...chromium },
    },
    {
        name: 'chromium-phone',
        use: { ...devices['Desktop Chrome'], ...phone, ...chromium },
    },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...desktop } },
    { name: 'webkit-phone', use: { ...devices['Desktop Safari'], ...phone } },
];

export default defineConfig({
    testDir: './e2e',
    outputDir: './test-results',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: [['list']],
    timeout: 30_000,
    use: {
        baseURL: `${origin}/ccm/ctpassstore/`,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        colorScheme: 'light',
        trace: 'retain-on-failure',
    },
    projects,
    webServer: {
        // Demo mode (the default of `npm run dev`); never `--mode real`.
        command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: `${origin}/ccm/ctpassstore/`,
        reuseExistingServer: false,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
