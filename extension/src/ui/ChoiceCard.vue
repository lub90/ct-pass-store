<script setup lang="ts">
/**
 * One option of a radio group shown as a card; the checked card is highlighted via `:has(> input:checked)`.
 * Cards of one group share `name`: the browser handles Tab (into the group) and the arrow keys (between cards).
 */
import { useId } from 'vue';

const props = defineProps<{ modelValue?: string; value: string; name: string; label: string; help?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const uid = useId();
</script>

<template>
    <label class="cps-choice">
        <input
            type="radio"
            class="cps-choice__input"
            :name="name"
            :value="value"
            :checked="modelValue === value"
            :aria-describedby="help ? `${uid}-help` : undefined"
            @change="emit('update:modelValue', props.value)"
        >
        <span class="cps-choice__text">
            <span class="cps-choice__label">{{ label }}</span>
            <span
                v-if="help"
                :id="`${uid}-help`"
                class="cps-choice__help"
            >{{ help }}</span>
        </span>
    </label>
</template>

<style scoped>
.cps-choice {
    display: flex;
    align-items: flex-start;
    gap: var(--cps-space-3);
    box-sizing: border-box;
    min-height: var(--cps-control-h);
    padding: var(--cps-space-3) var(--cps-space-4);
    border: 1px solid var(--cps-divider);
    border-radius: var(--cps-radius-lg);
    background: var(--cps-surface);
    cursor: pointer;
    transition:
        background-color var(--cps-transition),
        border-color var(--cps-transition);
}
.cps-choice:hover {
    border-color: color-mix(in oklab, var(--cps-divider) 70%, var(--cps-text));
}
.cps-choice:has(> input:checked) {
    border-color: var(--cps-accent);
    background: var(--cps-accent-pale);
}
.cps-choice:has(> input:focus-visible) {
    outline: 2px solid var(--cps-accent);
    outline-offset: 2px;
}
.cps-choice__input {
    flex: none;
    margin: 2px 0 0;
    accent-color: var(--cps-accent);
}
.cps-choice__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.cps-choice__label {
    font-weight: var(--cps-weight-strong);
}
.cps-choice__help {
    font-size: var(--cps-size-sm);
    color: var(--cps-text-muted);
}
</style>
