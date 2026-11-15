<script setup lang="ts">
/** A short status label. The dot carries the colour; the text stays in the text colour on a neutral ground. */
defineProps<{ kind: 'ok' | 'neutral' | 'warning' | 'error' }>();
</script>

<template>
    <span
        class="cps-pill"
        :class="`cps-pill--${kind}`"
    ><slot /></span>
</template>

<style scoped>
.cps-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--cps-space-2);
    padding: 2px var(--cps-space-3);
    border-radius: 999px;
    background: var(--cps-panel);
    border: 1px solid var(--cps-divider);
    color: var(--cps-text);
    font-size: var(--cps-size-sm);
    line-height: 1.4;
    white-space: nowrap;
}
.cps-pill::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cps-text-muted);
}
.cps-pill--ok::before {
    background: var(--cps-success);
}
.cps-pill--warning::before {
    background: var(--cps-warning);
}
.cps-pill--error::before {
    background: var(--cps-danger);
}
</style>
