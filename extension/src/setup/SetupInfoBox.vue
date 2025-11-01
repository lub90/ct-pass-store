<template>
    <div
        v-if="visible"
        class="alert alert-info d-flex align-items-start gap-2 py-2 px-3 mb-3"
    >
        <i class="bi bi-info-circle-fill text-info mt-1"></i>
        <div v-html="content" />
    </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';

defineProps<{
    visible: boolean;
    content: string;
}>();
</script>
