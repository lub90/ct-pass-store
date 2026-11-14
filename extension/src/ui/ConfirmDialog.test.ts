import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import ConfirmDialog from './ConfirmDialog.vue';
import { answerConfirm, pendingConfirm, useConfirm } from './useConfirm';
import type { ConfirmOptions } from './useConfirm';

const base: ConfirmOptions = { title: 'Delete?', text: 'Gone forever', confirmLabel: 'Delete', cancelLabel: 'Cancel' };
let w: VueWrapper;
let opener: HTMLButtonElement;

/** Asks and waits until the dialog is drawn and focused; the result promise stays unresolved until answered. */
function open(options: ConfirmOptions = base) {
    const result = useConfirm()(options);
    return { result, shown: flush() };
}
async function flush() {
    await nextTick();
    await nextTick();
}
const btn = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
function key(k: string, init: KeyboardEventInit = {}) {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

describe('ConfirmDialog', () => {
    beforeEach(() => {
        opener = document.createElement('button');
        opener.textContent = 'opener';
        document.body.append(opener);
        opener.focus();
        w = mount(ConfirmDialog, { attachTo: document.body });
    });
    afterEach(() => {
        while (pendingConfirm.value) answerConfirm({ confirmed: false });
        w.unmount();
        opener.remove();
    });

    it('is a modal alertdialog with title and text', async () => {
        await open().shown;
        const d = document.body.querySelector('[role="alertdialog"]')!;
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toContain('Delete?');
        expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toContain('Gone forever');
    });

    it('names a person with a detail line below the name, as plain text, and describes the dialog with both', async () => {
        await open({ ...base, subject: { name: '<b>Anna</b> {x}', detail: 'ID 12' } }).shown;
        const d = document.body.querySelector('[role="alertdialog"]')!;
        const subject = d.querySelector('.cps-confirm__subject')!;
        expect(subject.querySelector('.cps-confirm__subject-name')!.textContent).toBe('<b>Anna</b> {x}');
        expect(subject.querySelector('b')).toBeNull();
        const detail = subject.querySelector('.cps-confirm__subject-detail')!;
        expect(detail.textContent).toBe('ID 12');
        // Name first, then the detail, then the sentence: a screen reader reads „<name> ID 12 <text>“.
        const described = d.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent?.trim());
        expect(described).toEqual(['<b>Anna</b> {x}', 'ID 12', 'Gone forever']);
    });

    it('has no subject block without a subject', async () => {
        await open().shown;
        expect(document.body.querySelector('.cps-confirm__subject')).toBeNull();
        expect(document.body.querySelector('[role="alertdialog"]')!.getAttribute('aria-describedby')!.split(' ')).toHaveLength(1);
    });

    it('focuses confirm normally and cancel for danger', async () => {
        await open().shown;
        expect(document.activeElement).toBe(btn('Delete'));
        answerConfirm({ confirmed: false });
        await nextTick();
        await open({ ...base, danger: true }).shown;
        expect(document.activeElement).toBe(btn('Cancel'));
    });

    it('traps Tab in both directions', async () => {
        await open().shown;
        const cancel = btn('Cancel');
        const confirm = btn('Delete');
        expect(document.activeElement).toBe(confirm);
        key('Tab');
        expect(document.activeElement).toBe(cancel);
        cancel.focus();
        key('Tab', { shiftKey: true });
        expect(document.activeElement).toBe(confirm);
    });

    it('does not let Tab leave when focus is outside', async () => {
        await open().shown;
        opener.focus();
        key('Tab');
        expect(document.body.querySelector('[role="alertdialog"]')!.contains(document.activeElement)).toBe(true);
    });

    it('Escape resolves not confirmed and returns focus to the opener', async () => {
        const { result: p, shown } = open();
        await shown;
        key('Escape');
        await nextTick();
        await expect(p).resolves.toEqual({ confirmed: false });
        expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    describe('an opener that is disabled while its action runs (found by the browser tests)', () => {
        /**
         * A browser blurs a focused button that becomes disabled; the page's focus is then on body. (jsdom doesn't, and
         * won't blur a disabled element, so the blur comes first here.)
         */
        function disableOpener() {
            opener.blur();
            opener.focus();
            opener.blur();
            opener.disabled = true;
            expect(document.activeElement).toBe(document.body);
        }

        it('gets the focus back once it is enabled again', async () => {
            disableOpener();
            const { result: p, shown } = open();
            await shown;
            key('Escape');
            await p;
            await flush();
            expect(document.activeElement).not.toBe(opener);
            opener.disabled = false;
            await flush();
            expect(document.activeElement).toBe(opener);
        });

        it('gets it right away if it is enabled by the time the dialog closes', async () => {
            disableOpener();
            const { result: p, shown } = open();
            await shown;
            opener.disabled = false;
            key('Escape');
            await p;
            await flush();
            expect(document.activeElement).toBe(opener);
        });

        it('does not take the focus back once the person has moved it elsewhere', async () => {
            disableOpener();
            const { result: p, shown } = open();
            await shown;
            key('Escape');
            await p;
            await flush();
            const other = document.createElement('input');
            document.body.append(other);
            other.focus();
            opener.disabled = false;
            await flush();
            expect(document.activeElement).toBe(other);
            other.remove();
        });

        it('stops waiting when the next dialog opens', async () => {
            disableOpener();
            const first = open();
            await first.shown;
            key('Escape');
            await first.result;
            await flush();
            const second = open();
            await second.shown;
            const inDialog = document.activeElement;
            opener.disabled = false;
            await flush();
            expect(document.activeElement).toBe(inDialog);
        });

        // Focus on body for another reason (the person clicked on empty space): the last focused element didn't open
        // the dialog, so the focus doesn't jump to it afterwards; it stays where the person left it.
        it('does not return to a stale, enabled element the person had left', async () => {
            const field = document.createElement('input');
            document.body.append(field);
            field.focus();
            field.blur();
            expect(document.activeElement).toBe(document.body);
            const { result: p, shown } = open();
            await shown;
            key('Escape');
            await p;
            await flush();
            expect(document.activeElement).toBe(document.body);
            field.remove();
        });
    });

    it('confirm resolves confirmed; a click on the backdrop cancels', async () => {
        const { result: p, shown } = open();
        await shown;
        btn('Delete').click();
        await expect(p).resolves.toEqual({ confirmed: true });
        const { result: q, shown: shown2 } = open();
        await shown2;
        (document.body.querySelector('.cps-confirm') as HTMLElement).click();
        await expect(q).resolves.toEqual({ confirmed: false });
    });

    it('mustEqual keeps confirm disabled until the text matches, then returns the value', async () => {
        const { result: p, shown } = open({ ...base, field: { label: 'Type name', type: 'text', mustEqual: 'Anna' } });
        await shown;
        const input = document.body.querySelector('input')!;
        expect(document.activeElement).toBe(input);
        expect(btn('Delete').disabled).toBe(true);
        input.value = 'Ann';
        input.dispatchEvent(new Event('input'));
        await nextTick();
        expect(btn('Delete').disabled).toBe(true);
        input.value = 'Anna';
        input.dispatchEvent(new Event('input'));
        await nextTick();
        expect(btn('Delete').disabled).toBe(false);
        btn('Delete').click();
        await expect(p).resolves.toEqual({ confirmed: true, value: 'Anna' });
    });

    it('a password field needs input, is masked and returns the value', async () => {
        const { result: p, shown } = open({ ...base, field: { label: 'Password', type: 'password' } });
        await shown;
        const input = document.body.querySelector('input')!;
        expect(input.type).toBe('password');
        expect(btn('Delete').disabled).toBe(true);
        input.value = 'secret';
        input.dispatchEvent(new Event('input'));
        await nextTick();
        btn('Delete').click();
        await expect(p).resolves.toEqual({ confirmed: true, value: 'secret' });
    });

    it('shows a queued request after the first is answered, with an empty field', async () => {
        const { result: first, shown } = open({ ...base, title: 'one', field: { label: 'F', type: 'text' } });
        await shown;
        const second = useConfirm()({ ...base, title: 'two', field: { label: 'F', type: 'text' } });
        const input = document.body.querySelector('input')!;
        input.value = 'x';
        input.dispatchEvent(new Event('input'));
        await nextTick();
        btn('Delete').click();
        await first;
        await nextTick();
        await nextTick();
        expect(document.body.textContent).toContain('two');
        expect(document.body.querySelector('input')!.value).toBe('');
        answerConfirm({ confirmed: false });
        await second;
    });

    describe('forgets the typed secret', () => {
        const typed = async () => {
            const { result, shown } = open({ ...base, field: { label: 'Password', type: 'password' } });
            await shown;
            const input = document.body.querySelector('input')!;
            input.value = 'hunter2';
            input.dispatchEvent(new Event('input'));
            await nextTick();
            return { result };
        };
        const forgotten = async () => {
            await flush();
            expect((w.vm as unknown as { value: string }).value).toBe('');
            expect(document.body.innerHTML).not.toContain('hunter2');
            expect([...document.body.querySelectorAll('input')].every((i) => i.value === '')).toBe(true);
            const next = open({ ...base, field: { label: 'Password', type: 'password' } });
            await next.shown;
            expect(document.body.querySelector('input')!.value).toBe('');
            answerConfirm({ confirmed: false });
            await next.result;
        };

        it('after confirm', async () => {
            const { result } = await typed();
            btn('Delete').click();
            await expect(result).resolves.toEqual({ confirmed: true, value: 'hunter2' });
            await forgotten();
        });
        it('after cancel', async () => {
            const { result } = await typed();
            btn('Cancel').click();
            await result;
            await forgotten();
        });
        it('after Escape', async () => {
            const { result } = await typed();
            key('Escape');
            await result;
            await forgotten();
        });
    });
});
