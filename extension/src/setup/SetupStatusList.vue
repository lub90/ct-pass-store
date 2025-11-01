<template>
    <ul class="list-group mb-3">
        <li
            v-for="(status, index) in items"
            :key="index"
            class="list-group-item d-flex align-items-center gap-2"
            :class="status.variant ? `text-${status.variant}` : ''"
        >
            <span v-if="status.pending" class="spinner-border spinner-border-sm text-secondary" role="status" />
            <i v-else :class="`bi ${status.icon}`"></i>
            <span>{{ status.message }}</span>
        </li>
    </ul>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';

export type StatusItem = {
    pending: boolean;
    message: string;
    icon?: string;
    variant?: 'success' | 'danger';
};

defineProps<{
    items: StatusItem[];
}>();
</script>
