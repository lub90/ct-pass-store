<template>
    <div>
        <div class="text-h5 mb-6">{{ title }}</div>
        <slot />
    </div>
</template>

<script setup lang="ts">

defineProps<{
    title: string;
}>();
</script>
