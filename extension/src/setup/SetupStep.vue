<template>
    <div>
        <h5>{{ title }}</h5>
        <slot />
    </div>
</template>

<script setup lang="ts">

defineProps<{
    title: string;
}>();
</script>
