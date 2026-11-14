/**
 * Phone layout and touch targets (spec 9.3, 1.3) on every route, in the states where most is on screen: no
 * horizontal scrolling, every button and input at least 44 px high with touch, input text at 16 px on a phone.
 */
import { expect, test, type Page } from '@playwright/test';
import { CLARA, DEMO_CT_PASSWORD, ROUTES, hideDemoSwitch, openDemo } from './demo';

interface Target {
    what: string;
    height: number;
}

/** No horizontal scrolling: the page is never wider than the window. */
async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${where}: scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}

/**
 * Heights of every visible control of the app (not the demo switch). A switch and a radio or checkbox are hit through
 * the label around them (Toggle, ChoiceCard), so the label counts for them.
 */
function targetHeights(page: Page): Promise<Target[]> {
    return page.evaluate(() => {
        const describe = (el: Element) =>
            `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[type=${el.getAttribute('type')}]` : ''} "${(
                el.getAttribute('aria-label') ??
                el.textContent ??
                ''
            )
                .trim()
                .slice(0, 40)}"`;
        const visible = (el: Element) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
        };
        const controls = [
            ...document.querySelectorAll('.cps button, .cps input:not([type=hidden]), .cps select, .cps textarea'),
        ].filter((el) => !el.closest('aside[aria-label="Demo-Modus"]'));
        return controls
            .map((el) => {
                const viaLabel = el.getAttribute('role') === 'switch' || ['radio', 'checkbox'].includes(el.getAttribute('type') ?? '');
                const target = viaLabel ? (el.closest('label') ?? el) : el;
                // A radio inside a label is visible through its label even when drawn small.
                if (!visible(target)) return null;
                return { what: describe(el), height: Math.round(target.getBoundingClientRect().height * 10) / 10 };
            })
            .filter((x): x is { what: string; height: number } => x !== null);
    });
}

async function expectTouchTargets(page: Page, where: string): Promise<void> {
    const targets = await targetHeights(page);
    const small = targets.filter((t) => t.height < 44).map((t) => `${t.what}: ${t.height}px`);
    expect(small, `${where}: controls below 44 px`).toEqual([]);
}

/** Text fields, selects and text areas use 16 px (no iOS zoom on tap). */
async function expectInputFont(page: Page, where: string): Promise<void> {
    const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('.cps input:not([type=hidden], [type=radio], [type=checkbox]), .cps select, .cps textarea')]
            .filter((el) => !el.closest('aside[aria-label="Demo-Modus"]') && el.getBoundingClientRect().height > 0)
            .map((el) => ({ what: `${el.tagName.toLowerCase()} ${el.id || el.getAttribute('aria-label') || ''}`, size: getComputedStyle(el).fontSize })),
    );
    const wrong = sizes.filter((s) => s.size !== '16px').map((s) => `${s.what}: ${s.size}`);
    expect(wrong, `${where}: inputs not at 16 px`).toEqual([]);
}

/** Phone (spec 9.3): the buttons of a form's action row stretch to the row's full width. */
async function expectFullWidthFormButtons(page: Page, where: string): Promise<void> {
    const rows = await page.evaluate(() =>
        [...document.querySelectorAll('.cps .cps-form-actions')]
            .filter((row) => row.getBoundingClientRect().height > 0)
            .flatMap((row) => {
                const width = row.getBoundingClientRect().width;
                return [...row.querySelectorAll(':scope > button.cps-btn')].map((b) => ({
                    what: (b.textContent ?? '').trim(),
                    width: b.getBoundingClientRect().width,
                    row: width,
                }));
            }),
    );
    const narrow = rows.filter((b) => b.width < b.row - 1).map((b) => `"${b.what}": ${Math.round(b.width)} of ${Math.round(b.row)} px`);
    expect(narrow, `${where}: form buttons not full width`).toEqual([]);
}

/** Each rule of the password form keeps its mark on the line where its text starts (spec 4.2, ticked off live). */
async function expectRuleMarksBesideText(page: Page, where: string): Promise<void> {
    const rules = await page.evaluate(() =>
        [...document.querySelectorAll('.cps-rules li')].map((li) => {
            const mark = li.querySelector('.cps-rules__mark')!.getBoundingClientRect();
            const text = li.querySelector('.cps-rules__mark + span')!.getBoundingClientRect();
            return { rule: li.getAttribute('data-rule'), markTop: mark.top, textTop: text.top, textLeft: text.left, markRight: mark.right };
        }),
    );
    const detached = rules.filter((r) => Math.abs(r.markTop - r.textTop) > 4 || r.textLeft < r.markRight).map((r) => r.rule);
    expect(detached, `${where}: rule marks not beside their text`).toEqual([]);
}

/** States beyond a route's first view: the forms and the dialog, where the most controls are on screen. */
const STATES: { name: string; scenario: 'user' | 'admin'; path: string; open: (page: Page) => Promise<void> }[] = [
    {
        name: 'Mein Passwort, custom form',
        scenario: 'user',
        path: './',
        open: async (page) => {
            await page.getByRole('button', { name: 'Passwort festlegen' }).click();
            await page.getByRole('radio', { name: 'Selbst wählen' }).check();
            await page.getByLabel('Neues Passwort', { exact: true }).fill('ä ö-Demo');
        },
    },
    {
        name: 'Mein Passwort, result',
        scenario: 'user',
        path: './',
        open: async (page) => {
            await page.getByRole('button', { name: 'Passwort festlegen' }).click();
            await page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill(DEMO_CT_PASSWORD);
            await page.getByRole('button', { name: 'Passwort erzeugen' }).click();
            await expect(page.getByLabel('Dein neues Passwort')).toHaveValue(/.{16}/);
        },
    },
    {
        name: 'Passwörter verwalten, search list',
        scenario: 'admin',
        path: 'manage',
        open: async (page) => {
            await page.getByRole('combobox', { name: 'Person aus der Nutzergruppe suchen' }).fill('a');
            await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
        },
    },
    {
        name: 'Passwörter verwalten, flow for someone else',
        scenario: 'admin',
        path: `manage/${CLARA.id}`,
        open: async (page) => {
            await page.getByRole('button', { name: 'Neues Passwort' }).click();
            await page.getByRole('radio', { name: 'Selbst wählen' }).check();
        },
    },
    {
        name: 'delete dialog with password field',
        scenario: 'admin',
        path: `manage/${CLARA.id}`,
        open: async (page) => {
            await page.getByRole('button', { name: 'Neues Passwort' }).click();
            await page.getByLabel('Dein ChurchTools-Passwort (zur Bestätigung)').fill(DEMO_CT_PASSWORD);
            await page.getByRole('button', { name: 'Passwort erzeugen' }).click();
            await page.getByRole('button', { name: 'Fertig' }).click();
            await page.getByRole('button', { name: 'Löschen' }).click();
            await expect(page.getByRole('alertdialog')).toBeVisible();
        },
    },
    {
        name: 'Backend & Status after a self-test',
        scenario: 'admin',
        path: 'settings/backend',
        open: async (page) => {
            await page.getByRole('button', { name: 'Schreibtest ausführen' }).click();
            await expect(page.getByText('Prüft …')).toHaveCount(0);
        },
    },
];

/** Each route and state, measured in the current project; `touch` forces touch for the 44 px check. */
function layoutTests(touch: boolean): void {
    const check = async (page: Page, where: string) => {
        await expectNoHorizontalScroll(page, where);
        if (touch) await expectTouchTargets(page, where);
        if ((page.viewportSize()?.width ?? 0) <= 768) {
            await expectInputFont(page, where);
            await expectFullWidthFormButtons(page, where);
        }
        await expectRuleMarksBesideText(page, where);
    };
    for (const { path, scenario } of ROUTES) {
        test(`${scenario} ${path}`, async ({ page }) => {
            await openDemo(page, scenario, path);
            await hideDemoSwitch(page);
            await check(page, `${scenario} ${path}`);
        });
    }
    for (const state of STATES) {
        test(`${state.scenario} ${state.name}`, async ({ page }) => {
            await openDemo(page, state.scenario, state.path);
            await hideDemoSwitch(page);
            await state.open(page);
            await check(page, state.name);
        });
    }
}

test.describe('layout on every route', () => {
    // Without touch (the desktop projects); the phone projects have touch and are measured by the run below.
    test.skip(({ hasTouch }) => hasTouch, 'measured with touch below');
    layoutTests(false);
});

test.describe('44 px touch targets on every route', () => {
    test.use({ hasTouch: true });
    layoutTests(true);
});

test('touch emulation makes (pointer: coarse) match, so the 44 px rules are what is measured', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch projects only');
    await openDemo(page, 'user');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
});
