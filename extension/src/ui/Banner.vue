<script setup lang="ts">
/** A note in the flow of the page: 4 px border on the left, pale fill. Errors are announced at once. */
import Icon from './Icon.vue';

defineProps<{ kind: 'info' | 'warning' | 'error'; title?: string }>();
</script>

<template>
    <div
        class="cps-banner"
        :class="`cps-banner--${kind}`"
        :role="kind === 'error' ? 'alert' : 'status'"
    >
        <Icon
            :name="kind"
            :size="20"
        />
        <div class="cps-banner__body">
            <p
                v-if="title"
                class="cps-banner__title"
            >
                {{ title }}
            </p>
            <slot />
        </div>
    </div>
</template>

<style scoped>
.cps-banner {
    display: flex;
    gap: var(--cps-space-3);
    align-items: flex-start;
    padding: var(--cps-space-2) var(--cps-space-4);
    border-left: 4px solid var(--cps-accent);
    border-radius: var(--cps-radius);
    background: var(--cps-accent-pale);
    color: var(--cps-text);
}
.cps-banner--warning {
    border-left-color: var(--cps-warning);
    background: var(--cps-warning-pale);
}
.cps-banner--error {
    border-left-color: var(--cps-danger);
    background: var(--cps-danger-pale);
}
/* The symbol keeps the colour of the border; the text stays in the text colour (contrast on the pale fill). */
.cps-banner svg {
    margin-top: 2px;
    color: var(--cps-accent);
}
.cps-banner--warning svg {
    color: var(--cps-text);
}
.cps-banner--error svg {
    color: var(--cps-danger);
}
.cps-banner__body {
    min-width: 0;
}
.cps-banner__title {
    margin: 0;
    font-weight: var(--cps-weight-strong);
}
</style>
