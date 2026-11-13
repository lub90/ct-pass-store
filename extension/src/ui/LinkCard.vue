<script setup lang="ts">
/**
 * A card that links to a page: icon, title, sentence, optional pill and a chevron. Disabled (a reason is given), it
 * is no link, only the card with the reason.
 *
 * Router: `ui/` may not import `vue-router`, so the link is `resolveComponent('RouterLink')` at runtime. The app has
 * the router installed and the name resolves to its `RouterLink`; without a router (tests, other hosts) it stays a
 * string and the card falls back to a plain `<a href>`.
 */
import { resolveComponent } from 'vue';
import Icon from './Icon.vue';
import type { IconName } from './Icon.vue';
import Pill from './Pill.vue';

defineProps<{
    to: string;
    icon: IconName;
    title: string;
    text: string;
    pill?: string;
    pillKind?: 'ok' | 'neutral' | 'warning' | 'error';
    disabledReason?: string;
}>();

const resolved = resolveComponent('RouterLink');
const isRouter = typeof resolved !== 'string';
</script>

<template>
    <div
        v-if="disabledReason"
        class="cps-linkcard cps-linkcard--disabled"
        aria-disabled="true"
    >
        <span class="cps-linkcard__icon"><Icon
            :name="icon"
            :size="22"
        /></span>
        <span class="cps-linkcard__body">
            <span class="cps-linkcard__title">{{ title }}</span>
            <span class="cps-linkcard__text">{{ text }}</span>
            <span class="cps-linkcard__reason">{{ disabledReason }}</span>
        </span>
    </div>
    <component
        :is="isRouter ? resolved : 'a'"
        v-else
        v-bind="isRouter ? { to } : { href: to }"
        class="cps-linkcard"
    >
        <span class="cps-linkcard__icon"><Icon
            :name="icon"
            :size="22"
        /></span>
        <span class="cps-linkcard__body">
            <span class="cps-linkcard__title">{{ title }}</span>
            <span class="cps-linkcard__text">{{ text }}</span>
        </span>
        <Pill
            v-if="pill"
            :kind="pillKind ?? 'neutral'"
        >
            {{ pill }}
        </Pill>
        <Icon
            class="cps-linkcard__chevron"
            name="chevronRight"
            :size="20"
        />
    </component>
</template>

<style scoped>
.cps-linkcard {
    display: flex;
    align-items: center;
    gap: var(--cps-space-3);
    box-sizing: border-box;
    min-height: 44px;
    padding: var(--cps-space-3) var(--cps-space-4);
    border: 1px solid var(--cps-divider);
    border-radius: var(--cps-radius-lg);
    background: var(--cps-surface);
    color: var(--cps-text);
    text-decoration: none;
    transition:
        background-color var(--cps-transition),
        border-color var(--cps-transition);
}
a.cps-linkcard:hover {
    background: var(--cps-panel);
    border-color: color-mix(in oklab, var(--cps-divider) 70%, var(--cps-text));
}
.cps-linkcard--disabled {
    background: var(--cps-panel);
}
.cps-linkcard__icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--cps-radius-lg);
    background: var(--cps-accent-pale);
    color: var(--cps-text);
}
.cps-linkcard__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.cps-linkcard__title {
    font-weight: var(--cps-weight-strong);
}
.cps-linkcard__text,
.cps-linkcard__reason {
    font-size: var(--cps-size-sm);
    color: var(--cps-text-muted);
}
.cps-linkcard__chevron {
    color: var(--cps-text-muted);
}
</style>
