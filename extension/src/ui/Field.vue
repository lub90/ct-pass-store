<script setup lang="ts">
/**
 * A label above a control, with help and error text. The control comes in through the slot and takes the ids from
 * the slot props: `<Field v-slot="{ id, describedby, invalid }"><input :id :aria-describedby :aria-invalid></Field>`.
 */
import { computed, useId } from 'vue';

const props = defineProps<{ label: string; help?: string; error?: string; id?: string }>();

const generated = useId();
const controlId = computed(() => props.id ?? `cps-f-${generated}`);
const helpId = computed(() => `${controlId.value}-help`);
const errorId = computed(() => `${controlId.value}-error`);
const describedby = computed(() => {
    const ids = [props.help ? helpId.value : '', props.error ? errorId.value : ''].filter(Boolean);
    return ids.length ? ids.join(' ') : undefined;
});
</script>

<template>
    <div class="cps-field">
        <label
            class="cps-field__label"
            :for="controlId"
        >{{ label }}</label>
        <slot
            :id="controlId"
            :describedby="describedby"
            :invalid="Boolean(error)"
        />
        <p
            v-if="help"
            :id="helpId"
            class="cps-field__help"
        >
            {{ help }}
        </p>
        <p
            v-if="error"
            :id="errorId"
            class="cps-field__error"
            role="alert"
        >
            {{ error }}
        </p>
    </div>
</template>

<style scoped>
.cps-field {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-1);
}
.cps-field__label {
    font-weight: var(--cps-weight-strong);
}
.cps-field__help,
.cps-field__error {
    margin: 0;
    font-size: var(--cps-size-sm);
}
.cps-field__help {
    color: var(--cps-text-muted);
}
.cps-field__error {
    color: var(--cps-text);
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
</style>
