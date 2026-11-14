/**
 * App layer (mounted): „Backend & Status“ (spec 4.8). The address field with its rules and the E15 warning before a
 * change is saved; the self-test (admins only) with its own button for the write test. The address the app talks to
 * stays the one of startup: a typed or freshly saved address never gets a request (and so never the token).
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PopupClosed } from '../../backend/auth';
import { BackendProblem, BackendUnreachable } from '../../backend/problems';
import { BACKEND, SETTINGS, answer, button, cleanup, click, dialog, settle, start, type SelfTestTests } from './settings-harness';

afterEach(cleanup);

const TEXT = {
    title: 'Backend & Status',
    label: 'Backend-Adresse',
    save: 'Speichern',
    discard: 'Verwerfen',
    saved: '✓ Gespeichert',
    cancel: 'Abbrechen',
    confirm: 'Adresse ändern',
    confirmTitle: 'Backend-Adresse ändern?',
    missingRight: 'Dir fehlt in ChurchTools das Recht „edit custom data“ auf die Kategorie „settings“.',
    warningTitle: 'Nur eine Adresse eintragen, der du vertraust',
    reloadNote: 'Die neue Adresse gilt erst, wenn die Seite neu geladen ist. Bis dahin arbeitet die Erweiterung mit der bisherigen.',
    reload: 'Seite neu laden',
    errors: {
        'not-https': 'Die Adresse muss mit https:// beginnen.',
        credentials: 'Die Adresse darf keinen Benutzernamen und kein Passwort enthalten.',
        query: 'Die Adresse darf kein „?“ enthalten.',
        fragment: 'Die Adresse darf kein „#“ enthalten.',
        invalid: 'Gib eine vollständige Adresse ein, z. B. https://passwort.example.org.',
    },
    selfTest: 'Selbsttest',
    adminsOnly: 'Den Selbsttest dürfen nur Admins ausführen, die beim Backend angemeldet sind.',
    runAgain: 'Erneut prüfen',
    runWrite: 'Schreibtest ausführen',
    writeHelp: 'Der Schreibtest legt einen Testwert im Passwortspeicher an, liest ihn und löscht ihn wieder. Echte Passwörter bleiben unberührt.',
    withWrite: 'Mit Schreibtest.',
    tested: `Geprüft wird das Backend unter ${BACKEND}.`,
    unreachable: 'Der Dienst ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
};

const NEW = 'https://neu.example';

const input = (w: VueWrapper) => w.find<HTMLInputElement>('#cps-backend-url');
const disabled = (w: VueWrapper, text: string) => button(w, text)!.element.disabled;
const fieldError = (w: VueWrapper) => w.find('.cps-field__error');
const warning = (w: VueWrapper) => w.find('.cps-backend__warning');
const checks = (w: VueWrapper) =>
    w.findAll('.cps-backend__check').map((li) => ({
        dot: li.find('.cps-pill').classes().find((c) => c.startsWith('cps-pill--')),
        label: li.find('.cps-pill').text(),
        name: li.find('.cps-backend__check-name').text(),
        message: li.find('.cps-backend__check-message').text(),
    }));
async function type(w: VueWrapper, text: string) {
    await input(w).setValue(text);
    await settle();
}
function clickNow(w: VueWrapper, text: string) {
    const b = button(w, text);
    if (!b) throw new Error(`No button „${text}“ in: ${w.text()}`);
    b.element.click();
}
const result = (tests: SelfTestTests, version = '0.1.7') => () => Promise.resolve({ version, summary: 'English summary', tests });
const deferred = <T>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
};

describe('Backend & Status: rights', () => {
    it('without „edit custom data“ on settings: a banner naming it, no field, nothing read, no self-test', async () => {
        const { wrapper, router, storeReads, selfTests } = await start({ path: '/', edit: ['access'] });
        const before = storeReads.settings;
        await router.push('/settings/backend');
        await settle();
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(wrapper.find('main .cps-banner--warning').text()).toBe(TEXT.missingRight);
        expect(input(wrapper).exists()).toBe(false);
        expect(storeReads.settings).toBe(before);
        expect(selfTests).toEqual([]);
        expect(wrapper.text()).not.toContain(TEXT.selfTest);
    });

    it('a settings editor who is no admin edits the address, but the self-test is neither run nor offered', async () => {
        const { wrapper, selfTests } = await start({ path: '/settings/backend', admin: false });
        expect(input(wrapper).element.value).toBe(BACKEND);
        expect(selfTests).toEqual([]);
        expect(wrapper.find('.cps-backend__selftest').text()).toContain(TEXT.adminsOnly);
        expect(button(wrapper, TEXT.runAgain)).toBeUndefined();
        expect(button(wrapper, TEXT.runWrite)).toBeUndefined();
    });
});

describe('Backend & Status: the address (spec 4.8, E15)', () => {
    it('shows the stored address, a back link, no warning and disabled Save', async () => {
        const { wrapper } = await start({ path: '/settings/backend' });
        expect(wrapper.find('h1').text()).toBe(TEXT.title);
        expect(wrapper.find('a[href="/settings"]').exists()).toBe(true);
        expect(wrapper.find('label[for="cps-backend-url"]').text()).toBe(TEXT.label);
        expect(input(wrapper).element.value).toBe(BACKEND);
        expect(warning(wrapper).exists()).toBe(false);
        expect(disabled(wrapper, TEXT.save)).toBe(true);
    });

    it.each([
        ['http://neu.example', 'not-https'],
        ['https://user:pw@neu.example', 'credentials'],
        ['https://neu.example?x', 'query'],
        ['https://neu.example#y', 'fragment'],
        ['https://neu.example ', 'invalid'],
        ['', 'invalid'],
    ] as const)('%j is refused at the field (%s) and can’t be saved', async (text, reason) => {
        const { wrapper, writes } = await start({ path: '/settings/backend' });
        await type(wrapper, text);
        expect(fieldError(wrapper).text()).toBe(TEXT.errors[reason]);
        expect(fieldError(wrapper).attributes('role')).toBe('alert');
        expect(input(wrapper).attributes('aria-invalid')).toBe('true');
        expect(disabled(wrapper, TEXT.save)).toBe(true);
        await wrapper.find('form').trigger('submit');
        await settle();
        expect(dialog()).toBeNull();
        expect(writes).toEqual([]);
    });

    it('warns before saving as soon as the address differs from the stored one', async () => {
        const { wrapper } = await start({ path: '/settings/backend' });
        await type(wrapper, NEW);
        const text = warning(wrapper).text();
        expect(text).toContain(TEXT.warningTitle);
        expect(text).toContain('ChurchTools-Passwort');
        expect(text).toContain('Zweitpasswort');
        expect(text).toContain('Maschinen-Clients');
        expect(warning(wrapper).classes()).toContain('cps-banner--warning');
        // The stored address with a trailing slash is the same address: no warning, nothing to save.
        await type(wrapper, `${BACKEND}/`);
        expect(warning(wrapper).exists()).toBe(false);
        expect(disabled(wrapper, TEXT.save)).toBe(true);
    });

    it('saving a new address asks in a danger dialog naming both; „Abbrechen“ writes nothing and keeps the input', async () => {
        const { wrapper, writes } = await start({ path: '/settings/backend' });
        await type(wrapper, `${NEW}/`);
        await click(wrapper, TEXT.save);
        const d = dialog()!;
        expect(d.textContent).toContain(TEXT.confirmTitle);
        expect(d.textContent).toContain(BACKEND);
        expect(d.textContent).toContain(NEW);
        expect(d.querySelector('.cps-btn--danger')?.textContent?.trim()).toBe(TEXT.confirm);
        await answer(TEXT.cancel);
        expect(writes).toEqual([]);
        expect(input(wrapper).element.value).toBe(`${NEW}/`);
        expect(disabled(wrapper, TEXT.save)).toBe(false);
        expect(wrapper.find('.cps-settings-form__saved').exists()).toBe(false);
    });

    it('confirmed: writes only the address (normalized), keeps every other field, and says it takes effect after a reload', async () => {
        const { wrapper, stored } = await start({ path: '/settings/backend', settings: { ...SETTINGS, texts: { de: { title: 'T' } }, future: { a: 1 } } });
        await type(wrapper, `${NEW}/`);
        await click(wrapper, TEXT.save);
        await answer(TEXT.confirm);
        expect(await stored()).toEqual({ ...SETTINGS, texts: { de: { title: 'T' } }, future: { a: 1 }, backendUrl: NEW, revision: SETTINGS.revision + 1 });
        expect(wrapper.find('[role="status"].cps-settings-form__saved').text()).toBe(TEXT.saved);
        expect(warning(wrapper).exists()).toBe(false);
        const note = wrapper.find('.cps-backend__reload');
        expect(note.text()).toContain(TEXT.reloadNote);
        expect(note.find('button').text()).toBe(TEXT.reload);
    });

    it('a stale revision reports the conflict and writes nothing', async () => {
        const { wrapper, writes, changeElsewhere } = await start({ path: '/settings/backend' });
        await changeElsewhere({ passwordLength: 20 });
        await type(wrapper, NEW);
        await click(wrapper, TEXT.save);
        await answer(TEXT.confirm);
        expect(writes).toEqual([]);
        expect(wrapper.find('.cps-settings-form__conflict').exists()).toBe(true);
    });

    it('no reload note while the stored address is the one the app runs with', async () => {
        const { wrapper } = await start({ path: '/settings/backend' });
        expect(wrapper.find('.cps-backend__reload').exists()).toBe(false);
    });
});

describe('Backend & Status: the address the app talks to', () => {
    it('a typed address, and a newly saved one, never get a request: the self-test stays with the configured backend', async () => {
        const { wrapper, backendUrls, selfTests } = await start({ path: '/settings/backend' });
        await type(wrapper, NEW);
        await click(wrapper, TEXT.runAgain);
        await click(wrapper, TEXT.save);
        await answer(TEXT.confirm);
        await click(wrapper, TEXT.runWrite);
        expect(selfTests).toEqual([false, false, true]);
        expect(backendUrls.length).toBeGreaterThan(0);
        expect(new Set(backendUrls)).toEqual(new Set([BACKEND]));
        expect(wrapper.find('.cps-backend__tested').text()).toBe(TEXT.tested);
    });
});

describe('Backend & Status: self-test (spec 4.8)', () => {
    const TESTS: SelfTestTests = [
        { name: 'settings', status: 'ok', message: 'All settings can be read.' },
        { name: 'cache', status: 'fail', message: '<b>The cache folder is not writable.</b>' },
        { name: 'access', status: 'ok', message: 'The admin group is set.' },
    ];

    it('runs the read-only test once on open: every check with its dot, name and message as plain text', async () => {
        const { wrapper, selfTests } = await start({ path: '/settings/backend', selfTest: result(TESTS) });
        expect(selfTests).toEqual([false]);
        expect(checks(wrapper)).toEqual([
            { dot: 'cps-pill--ok', label: 'OK', name: 'settings', message: 'All settings can be read.' },
            { dot: 'cps-pill--error', label: 'Fehler', name: 'cache', message: '<b>The cache folder is not writable.</b>' },
            { dot: 'cps-pill--ok', label: 'OK', name: 'access', message: 'The admin group is set.' },
        ]);
        expect(wrapper.find('.cps-backend__selftest b').exists()).toBe(false);
        expect(wrapper.find('.cps-backend__passed').text()).toBe('2 von 3 Prüfungen bestanden.');
        expect(wrapper.find('.cps-backend__version').text()).toBe('Backend-Version: 0.1.7');
        expect(wrapper.text()).not.toContain('English summary');
    });

    it('the write test runs only on its own button, with an explanation', async () => {
        const { wrapper, selfTests } = await start({ path: '/settings/backend' });
        expect(wrapper.find('.cps-backend__write-help').text()).toBe(TEXT.writeHelp);
        await click(wrapper, TEXT.runAgain);
        expect(selfTests).toEqual([false, false]);
        expect(wrapper.find('.cps-backend__selftest').text()).not.toContain(TEXT.withWrite);
        await click(wrapper, TEXT.runWrite);
        expect(selfTests).toEqual([false, false, true]);
        expect(checks(wrapper).map((c) => c.name)).toContain('write');
        expect(wrapper.find('.cps-backend__selftest').text()).toContain(TEXT.withWrite);
    });

    it.each([TEXT.runAgain, TEXT.runWrite])('„%s“ renews the session inside the click (spec 7.2) before asking', async (label) => {
        const { wrapper, session, selfTests } = await start({ path: '/settings/backend' });
        const fresh = vi.spyOn(session, 'ensureFresh');
        clickNow(wrapper, label);
        expect(fresh).toHaveBeenCalledTimes(1);
        await settle();
        expect(selfTests).toHaveLength(2);
    });

    it('a failed renewal sends nothing', async () => {
        const { wrapper, session, selfTests } = await start({ path: '/settings/backend' });
        vi.spyOn(session, 'ensureFresh').mockRejectedValueOnce(new BackendUnreachable());
        await click(wrapper, TEXT.runWrite);
        expect(selfTests).toEqual([false]);
        expect(wrapper.find('.cps-backend__error').text()).toContain(TEXT.unreachable);
    });

    it('a closed renewal popup shows no error of its own (the session banner asks)', async () => {
        const { wrapper, session } = await start({ path: '/settings/backend' });
        vi.spyOn(session, 'ensureFresh').mockRejectedValueOnce(new PopupClosed());
        await click(wrapper, TEXT.runAgain);
        expect(wrapper.find('.cps-backend__error').exists()).toBe(false);
    });

    it('both buttons are disabled while a test runs', async () => {
        const slow = deferred<{ version: string; summary: string; tests: SelfTestTests }>();
        let calls = 0;
        const { wrapper, selfTests } = await start({ path: '/settings/backend', selfTest: () => (calls++ === 0 ? result(TESTS)() : slow.promise) });
        clickNow(wrapper, TEXT.runAgain);
        await settle();
        expect(disabled(wrapper, TEXT.runAgain)).toBe(true);
        expect(disabled(wrapper, TEXT.runWrite)).toBe(true);
        clickNow(wrapper, TEXT.runWrite);
        await settle();
        expect(selfTests).toEqual([false, false]);
        slow.resolve({ version: '0.1.0', summary: '', tests: TESTS });
        await settle();
        expect(disabled(wrapper, TEXT.runAgain)).toBe(false);
    });

    it('a failing run says why (role=alert), with the technical detail as plain text under „Details“', async () => {
        const problem = new BackendProblem('misconfigured', 500);
        problem.detail = '<i>JWT_SECRET</i> is too short';
        const { wrapper } = await start({ path: '/settings/backend', selfTest: () => Promise.reject(problem) });
        const error = wrapper.find('.cps-backend__error');
        expect(error.attributes('role')).toBe('alert');
        expect(error.text()).toContain('Der Dienst ist noch nicht richtig eingerichtet.');
        expect(error.find('details p').text()).toBe('<i>JWT_SECRET</i> is too short');
        expect(error.find('i').exists()).toBe(false);
        expect(button(wrapper, TEXT.runAgain)).toBeDefined();
    });

    it('updates the overview’s pill: coming back to „Einstellungen“ shows this result without asking again', async () => {
        const { wrapper, router, selfTests } = await start({ path: '/settings/backend', selfTest: result(TESTS) });
        await router.push('/settings');
        await settle();
        expect(selfTests).toEqual([false]);
        const card = wrapper.findAll('main .cps-linkcard').find((c) => c.find('.cps-linkcard__title').text() === TEXT.title)!;
        expect(card.find('.cps-pill').text()).toBe('⚠ 1 Problem');
    });
});
