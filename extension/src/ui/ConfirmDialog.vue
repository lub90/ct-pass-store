<script setup lang="ts">
/**
 * The one question dialog (spec 9.2): `role="alertdialog"`, modal. The focus starts on cancel for a dangerous step and
 * on confirm otherwise, Tab stays inside, Escape cancels, and the focus returns to the opener (a button disabled while
 * its action runs gets it back once enabled). Mounted once in `App.vue`; `useConfirm()` asks, this answers. Texts come
 * with the request (no i18n in `ui/`).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import SecretField from './SecretField.vue';
import { answerConfirm, pendingConfirm } from './useConfirm';

const uid = useId();
const dialog = ref<HTMLElement | null>(null);
const value = ref('');
let opener: HTMLElement | null = null;
/** The last element outside the dialog that got the focus. */
let lastFocused: HTMLElement | null = null;
let stopWaiting = (): void => undefined;

function track(event: FocusEvent) {
    if (event.target instanceof HTMLElement && !dialog.value?.contains(event.target)) lastFocused = event.target;
}

/**
 * The element to return to. Usually the focused one; but a page often disables its button while the action the dialog
 * belongs to runs, and the browser then moves the focus to body, so the last focused element counts.
 */
function findOpener(): HTMLElement | null {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) return active;
    return lastFocused?.isConnected ? lastFocused : null;
}

const focusIsLost = () => document.activeElement === null || document.activeElement === document.body;

/**
 * Focus returns to the opener (spec 9.4). A disabled opener gets it once it is enabled again, unless the focus has
 * moved elsewhere meanwhile or the next dialog opens.
 */
function restoreFocus(el: HTMLElement | null) {
    stopWaiting();
    if (!el?.isConnected) return;
    if (!(el as HTMLButtonElement).disabled) {
        el.focus();
        return;
    }
    const observer = new MutationObserver(() => {
        if (!el.isConnected || !focusIsLost()) return stopWaiting();
        if ((el as HTMLButtonElement).disabled) return;
        stopWaiting();
        el.focus();
    });
    observer.observe(el, { attributes: true, attributeFilter: ['disabled'] });
    stopWaiting = () => {
        observer.disconnect();
        stopWaiting = () => undefined;
    };
}

const request = computed(() => pendingConfirm.value);
/** Read in order: the subject's name, its detail, then the question. */
const describedBy = computed(() => {
    const subject = request.value?.subject;
    const ids = subject ? [`${uid}-subject`, ...(subject.detail ? [`${uid}-subject-detail`] : [])] : [];
    return [...ids, `${uid}-text`].join(' ');
});
const canConfirm = computed(() => {
    const field = request.value?.field;
    if (!field) return true;
    if (field.mustEqual !== undefined) return value.value === field.mustEqual;
    return value.value !== '';
});

function confirm() {
    if (!canConfirm.value || !request.value) return;
    const typed = value.value;
    const field = request.value.field;
    // The typed secret lives only until it is handed to the resolver.
    value.value = '';
    answerConfirm(field ? { confirmed: true, value: typed } : { confirmed: true });
}
function cancel() {
    value.value = '';
    answerConfirm({ confirmed: false });
}

function focusable(): HTMLElement[] {
    return [...(dialog.value?.querySelectorAll<HTMLElement>('button, input, [tabindex]') ?? [])].filter(
        (el) => !(el as HTMLButtonElement).disabled && el.getAttribute('tabindex') !== '-1',
    );
}

/** Capture phase on the window: while the dialog is open no key reaches the page behind it, except inside the dialog. */
function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
        event.preventDefault();
        return;
    }
    if (index < 0 || (event.shiftKey && index === 0)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && index === items.length - 1) {
        event.preventDefault();
        first.focus();
    }
}

watch(
    request,
    async (current, previous) => {
        if (current && !previous) {
            stopWaiting();
            opener = findOpener();
            window.addEventListener('keydown', onKey, true);
        } else if (!current && previous) {
            window.removeEventListener('keydown', onKey, true);
            value.value = '';
            restoreFocus(opener);
            opener = null;
        }
        if (current) {
            value.value = '';
            await nextTick();
            // A dangerous step asks "cancel?" first; otherwise the input (if any), else confirm.
            const selector = current.danger ? '[data-cancel]' : current.field ? 'input' : '[data-confirm]';
            dialog.value?.querySelector<HTMLElement>(selector)?.focus();
        }
    },
    { flush: 'post' },
);
onMounted(() => document.addEventListener('focusin', track, true));
onBeforeUnmount(() => {
    document.removeEventListener('focusin', track, true);
    stopWaiting();
    window.removeEventListener('keydown', onKey, true);
    value.value = '';
});
</script>

<template>
    <div
        v-if="request"
        :key="request.id"
        class="cps cps-confirm"
        @click.self="cancel"
    >
        <div
            ref="dialog"
            class="cps-confirm__dialog"
            role="alertdialog"
            aria-modal="true"
            :aria-labelledby="`${uid}-title`"
            :aria-describedby="describedBy"
        >
            <h2
                :id="`${uid}-title`"
                class="cps-confirm__title"
            >
                {{ request.title }}
            </h2>
            <p
                v-if="request.subject"
                class="cps-confirm__subject"
            >
                <!-- Isolated: names and addresses may carry their own writing direction. -->
                <bdi
                    :id="`${uid}-subject`"
                    class="cps-confirm__subject-name"
                >{{ request.subject.name }}</bdi>
                <bdi
                    v-if="request.subject.detail"
                    :id="`${uid}-subject-detail`"
                    class="cps-confirm__subject-detail"
                >{{ request.subject.detail }}</bdi>
            </p>
            <p
                :id="`${uid}-text`"
                class="cps-confirm__text"
            >
                {{ request.text }}
            </p>
            <form
                class="cps-confirm__form"
                @submit.prevent="confirm"
            >
                <SecretField
                    v-if="request.field?.type === 'password'"
                    v-model="value"
                    :label="request.field.label"
                    autocomplete="current-password"
                />
                <label
                    v-else-if="request.field"
                    class="cps-confirm__field"
                >
                    <span class="cps-confirm__label">{{ request.field.label }}</span>
                    <input
                        v-model="value"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                    >
                </label>
                <div class="cps-confirm__actions">
                    <button
                        type="button"
                        class="cps-btn"
                        data-cancel
                        @click="cancel"
                    >
                        {{ request.cancelLabel }}
                    </button>
                    <button
                        type="submit"
                        class="cps-btn"
                        :class="request.danger ? 'cps-btn--danger' : 'cps-btn--primary'"
                        data-confirm
                        :disabled="!canConfirm"
                    >
                        {{ request.confirmLabel }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>

<style scoped>
.cps-confirm {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--cps-space-4);
    background: color-mix(in oklab, black 45%, transparent);
}
.cps-confirm__dialog {
    box-sizing: border-box;
    width: 100%;
    max-width: 28rem;
    max-height: 100%;
    overflow: auto;
    padding: var(--cps-space-5);
    border-radius: var(--cps-radius-lg);
    background: var(--cps-surface);
    box-shadow: var(--cps-shadow-card);
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-3);
}
.cps-confirm__title {
    margin: 0;
    font-size: 1.125rem;
}
.cps-confirm__subject {
    display: flex;
    flex-direction: column;
    margin: 0;
}
.cps-confirm__subject-name {
    font-weight: var(--cps-weight-strong);
    overflow-wrap: anywhere;
}
.cps-confirm__subject-detail {
    font-size: var(--cps-size-sm);
    font-style: italic;
    color: var(--cps-text-meta);
}
.cps-confirm__text {
    margin: 0;
    color: var(--cps-text-muted);
}
.cps-confirm__form {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
}
.cps-confirm__field {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-1);
}
.cps-confirm__label {
    font-weight: var(--cps-weight-strong);
}
.cps-confirm__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--cps-space-2);
}
@media (max-width: 48rem) {
    .cps-confirm__actions {
        flex-direction: column-reverse;
    }
    .cps-confirm__actions > button {
        width: 100%;
    }
}
</style>
