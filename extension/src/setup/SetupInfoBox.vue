<template>
  <v-alert
    v-if="visible"
    type="info"
    variant="outlined"
    border="start"
    class="mb-3"
    density="compact"
  >
    <template #prepend>
      <v-icon color="info">mdi-information</v-icon>
    </template>

    <!-- Slot for flexible content -->
    <slot />
  </v-alert>
</template>

<script setup lang="ts">

defineProps<{
    visible: boolean;
    content: string;
}>();
</script>
