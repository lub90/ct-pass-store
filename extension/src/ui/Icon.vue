<script setup lang="ts">
/** Inline SVG from `@mdi/js` paths (no icon font). Decorative: the surrounding control carries the label. */
import * as icons from './icons';

export type IconName = keyof typeof icons;

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 });
</script>

<template>
    <svg
        class="cps-icon"
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
    >
        <path :d="icons[name]" />
    </svg>
</template>

<style scoped>
.cps-icon {
    flex: none;
    display: inline-block;
    vertical-align: middle;
}
</style>
