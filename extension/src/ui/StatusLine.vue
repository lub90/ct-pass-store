<script setup lang="ts">
/** One line for loading, empty and error states. Errors are announced at once, the others politely. */
defineProps<{ kind: 'loading' | 'empty' | 'error'; text: string }>();
</script>

<template>
    <p
        class="cps-status"
        :class="`cps-status--${kind}`"
        :role="kind === 'error' ? 'alert' : 'status'"
    >
        {{ text }}
    </p>
</template>

<style scoped>
.cps-status {
    margin: 0;
    padding: var(--cps-space-4) 0;
    color: var(--cps-text-muted);
}
.cps-status--error {
    color: var(--cps-danger);
}
</style>
