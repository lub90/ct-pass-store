<template>
  <!-- Loading -->
  <v-alert
    v-if="state === ViewState.Loading"
    type="info"
    density="compact"
    class="mx-auto my-4"
    max-width="1200"
  >
    <template #prepend>
      <v-progress-circular indeterminate color="primary" size="20" />
    </template>
    {{ loadingText }}
  </v-alert>

  <!-- Error -->
  <v-alert
    v-else-if="state === ViewState.Error"
    type="error"
    density="compact"
    class="mx-auto my-4"
    max-width="1200"
  >
    {{ errorText }}
  </v-alert>

  <!-- Success -->
  <v-sheet
    v-else-if="state === ViewState.Ready"
    elevation="0"
    color="transparent">
      <slot />
  </v-sheet>
</template>

<script setup lang="ts">
import { ViewState } from "../types/ViewState";
import { computed } from "vue";

const props = defineProps<{
  state: ViewState;
  error?: string | null;
  loadingText?: string;
}>();

const loadingText = computed(() => props.loadingText ?? "Loading...");
const errorText = computed(() => props.error ?? "An unexpected error occurred");
</script>
