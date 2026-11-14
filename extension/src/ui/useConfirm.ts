import { ref } from 'vue';

export interface ConfirmOptions {
    title: string;
    text: string;
    confirmLabel: string;
    cancelLabel: string;
    /** A destructive step: the confirm button is red and the focus starts on cancel. */
    danger?: boolean;
    /**
     * The person (or thing) the question is about, shown above the text: the name, and below it a small, muted detail
     * (e.g. an ID). Plain text.
     */
    subject?: { name: string; detail?: string };
    /** An input in the dialog (the admin's password, a name to type). `mustEqual`: confirm waits for exactly this text. */
    field?: { label: string; type: 'password' | 'text'; mustEqual?: string };
}

export type ConfirmResult = { confirmed: false } | { confirmed: true; value?: string };

export interface PendingConfirm extends ConfirmOptions {
    id: number;
    resolve: (result: ConfirmResult) => void;
}

/** The request on screen, if any. `ConfirmDialog` (mounted once in `App.vue`) renders it. */
export const pendingConfirm = ref<PendingConfirm | null>(null);
/** Requests that arrived while a dialog was open. */
const queue: PendingConfirm[] = [];
let nextId = 0;

/**
 * Concurrent requests are queued, first in first out: only one dialog is on screen, and each caller still gets its
 * own answer once its turn has come. (Rejecting or auto-cancelling the earlier one would resolve a promise nobody
 * answered.)
 */
function ask(options: ConfirmOptions): Promise<ConfirmResult> {
    return new Promise((resolve) => {
        const request: PendingConfirm = { ...options, id: nextId++, resolve };
        if (pendingConfirm.value) queue.push(request);
        else pendingConfirm.value = request;
    });
}

/** Closes the open dialog with the answer; its promise resolves, the next queued request (if any) shows. */
export function answerConfirm(result: ConfirmResult): void {
    const current = pendingConfirm.value;
    if (!current) return;
    pendingConfirm.value = queue.shift() ?? null;
    current.resolve(result);
}

/** Our own question dialog instead of `window.confirm`. `await` the result. */
export function useConfirm(): (options: ConfirmOptions) => Promise<ConfirmResult> {
    return ask;
}
