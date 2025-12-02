<template>
    <div
        v-if="finished"
        :class="['alert', allOkay ? 'alert-success' : 'alert-danger']"
        class="d-flex align-items-center gap-2 py-2 px-3 mb-3 fw-semibold"
    >
        <span v-if="allOkay">{{ successMessage }}</span>
        <span v-else>{{ errorMessage }}</span>
    </div>
</template>

<script setup lang="ts">

defineProps<{
    finished: boolean;
    allOkay: boolean;
    successMessage: string;
    errorMessage: string;
}>();
</script>
