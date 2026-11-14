<script setup lang="ts">
/**
 * A password-like field. The eye (reveal) and the copy button sit inside the field on its right edge. Texts come in
 * as props. Copying writes to the clipboard and shows `copiedLabel` for 2 s; a failure keeps the normal label and
 * emits `copy-failed` (the page decides what to tell the user).
 */
import { computed, onBeforeUnmount, ref, useAttrs, useId } from 'vue';
import Icon from './Icon.vue';

defineOptions({ inheritAttrs: false });

const COPIED_MS = 2000;

const props = defineProps<{
    label: string;
    /** Read-only display: the text to show (and copy) when there is no `v-model`. */
    value?: string;
    revealLabel?: string;
    hideLabel?: string;
    copyLabel?: string;
    copiedLabel?: string;
    readonly?: boolean;
    autocomplete?: string;
    help?: string;
    error?: string;
    /** Start with the value visible (a value shown once, such as a generated password). */
    revealed?: boolean;
    /** Monospace, so look-alike characters (l, 1, I, O, 0) can be told apart. */
    mono?: boolean;
}>();
const model = defineModel<string>();
const emit = defineEmits<{ 'copy-failed': [] }>();

const id = `cps-s-${useId()}`;
const attrs = useAttrs();
/** `class` and `style` belong to the wrapper; every other attribute (aria-*, name ...) lands on the input. */
const inputAttrs = computed(() => {
    const rest = { ...attrs };
    delete rest.class;
    delete rest.style;
    delete rest['aria-describedby'];
    return rest;
});
const describedby = computed(() => {
    const ids = [props.help ? `${id}-help` : '', props.error ? `${id}-error` : '', attrs['aria-describedby'] as string | undefined].filter(Boolean);
    return ids.length ? ids.join(' ') : undefined;
});
const shown = ref(props.revealed === true);
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const current = computed(() => model.value ?? props.value ?? '');
const canReveal = computed(() => Boolean(props.revealLabel && props.hideLabel));
const canCopy = computed(() => Boolean(props.copyLabel));
const buttons = computed(() => Number(canReveal.value) + Number(canCopy.value));

async function copy() {
    try {
        await navigator.clipboard.writeText(current.value);
    } catch {
        emit('copy-failed');
        return;
    }
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied.value = false), COPIED_MS);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
    <div
        class="cps-secret"
        :class="$attrs.class"
        :style="$attrs.style as never"
    >
        <label
            class="cps-secret__label"
            :for="id"
        >{{ label }}</label>
        <div class="cps-secret__box">
            <input
                v-bind="inputAttrs"
                :id="id"
                :aria-describedby="describedby"
                :aria-invalid="error ? true : undefined"
                class="cps-secret__input"
                :class="{ 'cps-secret__input--mono': mono }"
                :style="{ paddingRight: `calc(var(--cps-control-h) * ${buttons} + var(--cps-space-2))` }"
                :type="shown ? 'text' : 'password'"
                :value="current"
                :readonly="readonly"
                :autocomplete="autocomplete ?? 'off'"
                spellcheck="false"
                @input="model = ($event.target as HTMLInputElement).value"
            >
            <div class="cps-secret__actions">
                <button
                    v-if="canReveal"
                    type="button"
                    class="cps-btn cps-btn--ghost cps-btn--icon"
                    :aria-label="shown ? hideLabel : revealLabel"
                    :aria-pressed="shown"
                    @click="shown = !shown"
                >
                    <Icon :name="shown ? 'eyeOff' : 'eye'" />
                </button>
                <button
                    v-if="canCopy"
                    type="button"
                    class="cps-btn cps-btn--ghost cps-btn--icon"
                    :aria-label="copied ? copiedLabel : copyLabel"
                    @click="copy"
                >
                    <Icon :name="copied ? 'check' : 'copy'" />
                </button>
            </div>
        </div>
        <p
            v-if="help"
            :id="`${id}-help`"
            class="cps-secret__help"
        >
            {{ help }}
        </p>
        <p
            v-if="error"
            :id="`${id}-error`"
            class="cps-secret__error"
            role="alert"
        >
            {{ error }}
        </p>
        <span
            class="cps-secret__live"
            role="status"
        >{{ copied ? copiedLabel : '' }}</span>
    </div>
</template>

<style scoped>
.cps-secret {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-1);
}
.cps-secret__label {
    font-weight: var(--cps-weight-strong);
}
.cps-secret__box {
    position: relative;
}
.cps-secret__actions {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
}
/* The buttons sit on the field: no frame of their own, square to the field's height minus its border. */
.cps-secret__actions .cps-btn {
    min-height: calc(var(--cps-control-h) - 2px);
    width: calc(var(--cps-control-h) - 2px);
    margin-right: 1px;
}
.cps-secret__input--mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.cps-secret__help,
.cps-secret__error {
    margin: 0;
    font-size: var(--cps-size-sm);
}
.cps-secret__help {
    color: var(--cps-text-muted);
}
.cps-secret__error {
    color: var(--cps-text);
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
@media (pointer: coarse) {
    /* A finger needs 44 px: the actions run over the field's 1 px border, the buttons are full 44 px squares. */
    .cps-secret__actions {
        top: -1px;
        right: -1px;
        bottom: -1px;
    }
    .cps-secret__actions .cps-btn {
        min-height: 44px;
        width: 44px;
        margin-right: 0;
    }
}
.cps-secret__live {
    /* Announced politely, not drawn: the button label changes visibly already. */
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
