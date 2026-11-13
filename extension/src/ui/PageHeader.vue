<script setup lang="ts">
/** The head of a page: pale icon square, title, a sentence on what the page is for, and the actions on the right. */
import Icon, { type IconName } from './Icon.vue';

defineProps<{ icon: IconName; title: string; intro: string }>();
</script>

<template>
    <div class="cps-page-head">
        <span class="cps-page-head__icon"><Icon
            :name="icon"
            :size="24"
        /></span>
        <div class="cps-page-head__text">
            <h1>{{ title }}</h1>
            <p>{{ intro }}</p>
        </div>
        <div
            v-if="$slots.actions"
            class="cps-page-head__actions"
        >
            <slot name="actions" />
        </div>
    </div>
</template>

<style scoped>
.cps-page-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--cps-space-3) var(--cps-space-4);
}
.cps-page-head__icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--cps-radius-lg);
    background: var(--cps-accent-pale);
    color: var(--cps-accent);
}
.cps-page-head__text {
    flex: 1 1 16rem;
    min-width: 0;
}
h1 {
    margin: 0;
    font-size: 1.6em;
    line-height: 1.2;
}
p {
    margin: var(--cps-space-1) 0 0;
    color: var(--cps-text-muted);
}
.cps-page-head__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--cps-space-2);
}
@media (max-width: 48rem) {
    h1 {
        font-size: 1.35em;
    }
    .cps-page-head__icon {
        display: none;
    }
}
</style>
