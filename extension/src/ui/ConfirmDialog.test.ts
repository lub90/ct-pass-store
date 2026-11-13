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
