<script setup lang="ts">
/**
 * The frame of a page, by role (design decision E3). `card`: a normal user gets one centred card, no navigation.
 * `sidebar`: an admin gets a navigation on the left; below 48rem it becomes a dropdown (`<select>`) at the top.
 * Router: `ui/` may not import `vue-router`; the links are `resolveComponent('RouterLink')` at runtime (plain
 * `<a href>` without a router). The dropdown cannot be a link, so it emits `navigate` with the chosen path and the
 * app routes. `current` is the active path: that entry gets `aria-current="page"` and is selected in the dropdown.
 */
import { resolveComponent } from 'vue';
import Icon from './Icon.vue';
import type { IconName } from './Icon.vue';

export interface NavItem {
    to: string;
    label: string;
    icon: IconName;
    /** Pushed to the bottom of the sidebar (after the spacer). */
    bottom?: boolean;
}

defineProps<{
    mode: 'card' | 'sidebar';
    nav?: NavItem[];
    navLabel: string;
    current?: string;
}>();
const emit = defineEmits<{ navigate: [to: string] }>();

const resolved = resolveComponent('RouterLink');
const isRouter = typeof resolved !== 'string';
</script>

<template>
    <div
        v-if="mode === 'card'"
        class="cps cps-frame cps-frame--card"
    >
        <main class="cps-frame__card">
            <slot />
        </main>
    </div>
    <div
        v-else
        class="cps cps-frame cps-frame--sidebar"
    >
        <select
            class="cps-frame__dropdown"
            :aria-label="navLabel"
            :value="current"
            @change="emit('navigate', ($event.target as HTMLSelectElement).value)"
        >
            <option
                v-for="item in nav"
                :key="item.to"
                :value="item.to"
            >
                {{ item.label }}
            </option>
        </select>
        <nav
            class="cps-frame__nav"
            :aria-label="navLabel"
        >
            <template
                v-for="(item, i) in nav"
                :key="item.to"
            >
                <span
                    v-if="item.bottom && !nav?.[i - 1]?.bottom"
                    class="cps-frame__spacer"
                />
                <component
                    :is="isRouter ? resolved : 'a'"
                    v-bind="isRouter ? { to: item.to } : { href: item.to }"
                    class="cps-frame__link"
                    :aria-current="item.to === current ? 'page' : undefined"
                >
                    <Icon :name="item.icon" />
                    <span>{{ item.label }}</span>
                </component>
            </template>
        </nav>
        <main class="cps-frame__content">
            <slot />
        </main>
    </div>
</template>

<style scoped>
.cps-frame {
    box-sizing: border-box;
    min-height: 100%;
}
.cps-frame--card {
    display: flex;
    justify-content: center;
    padding: var(--cps-space-6) var(--cps-space-4);
}
.cps-frame__card {
    box-sizing: border-box;
    width: 100%;
    max-width: 40rem;
    padding: var(--cps-space-5);
    border: 1px solid var(--cps-divider);
    border-radius: var(--cps-radius-lg);
    background: var(--cps-surface);
    box-shadow: var(--cps-shadow-card);
}
.cps-frame--sidebar {
    display: flex;
    align-items: stretch;
    gap: var(--cps-space-5);
    padding: var(--cps-space-5);
}
.cps-frame__dropdown {
    display: none;
}
.cps-frame__nav {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-1);
    box-sizing: border-box;
    width: 15rem;
    padding-right: var(--cps-space-4);
    border-right: 1px solid var(--cps-divider);
}
.cps-frame__spacer {
    flex: 1;
}
.cps-frame__link {
    display: flex;
    align-items: center;
    gap: var(--cps-space-3);
    box-sizing: border-box;
    min-height: var(--cps-control-h);
    padding: 0 var(--cps-space-3);
    border-radius: var(--cps-radius-lg);
    color: var(--cps-text);
    text-decoration: none;
    transition: background-color var(--cps-transition);
}
.cps-frame__link:hover {
    background: var(--cps-panel);
}
.cps-frame__link[aria-current='page'] {
    background: var(--cps-accent-pale);
    font-weight: var(--cps-weight-strong);
}
.cps-frame__content {
    flex: 1;
    min-width: 0;
}
@media (max-width: 48rem) {
    .cps-frame--card {
        padding: var(--cps-space-4);
    }
    .cps-frame__card {
        padding: var(--cps-space-4);
    }
    .cps-frame--sidebar {
        flex-direction: column;
        gap: var(--cps-space-4);
        padding: var(--cps-space-4);
    }
    .cps-frame__nav {
        display: none;
    }
    .cps-frame__dropdown {
        display: block;
    }
}
</style>
