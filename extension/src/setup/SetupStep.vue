<template>
    <div>
        <v-typography class="text-h5 mb-6">{{ title }}</v-typography>
        <slot />
    </div>
</template>

<script setup lang="ts">

defineProps<{
    title: string;
}>();
</script>
