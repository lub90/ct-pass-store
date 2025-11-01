<template>
    <div>
        <p>{{ title }}</p>
        <slot />
    </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';

defineProps<{
    title: string;
}>();
</script>
