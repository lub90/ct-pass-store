import { beforeEach, describe, expect, it } from 'vitest';
import { answerConfirm, pendingConfirm, useConfirm } from './useConfirm';

const base = { title: 'T', text: 'X', confirmLabel: 'OK', cancelLabel: 'No' };

describe('useConfirm', () => {
    beforeEach(() => {
        while (pendingConfirm.value) answerConfirm({ confirmed: false });
    });

    it('shows the request and resolves with the answer', async () => {
        const p = useConfirm()(base);
        expect(pendingConfirm.value?.title).toBe('T');
        answerConfirm({ confirmed: true });
        await expect(p).resolves.toEqual({ confirmed: true });
        expect(pendingConfirm.value).toBeNull();
    });

    it('queues a second request: it shows after the first is answered, each gets its own answer', async () => {
        const confirm = useConfirm();
        const first = confirm({ ...base, title: 'first' });
        const second = confirm({ ...base, title: 'second' });
        expect(pendingConfirm.value?.title).toBe('first');
        answerConfirm({ confirmed: false });
        await expect(first).resolves.toEqual({ confirmed: false });
        expect(pendingConfirm.value?.title).toBe('second');
        answerConfirm({ confirmed: true, value: 'v' });
        await expect(second).resolves.toEqual({ confirmed: true, value: 'v' });
        expect(pendingConfirm.value).toBeNull();
    });

    it('answering with nothing open does nothing', () => {
        expect(() => answerConfirm({ confirmed: false })).not.toThrow();
    });
});
