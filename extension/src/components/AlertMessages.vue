<template>
  <v-sheet ref="root" class="my-4">

    <!-- Loading -->
    <v-alert
      v-if="state === AlertState.Loading"
      type="info"
      density="compact"
    >
      <template #prepend>
        <v-progress-circular indeterminate color="primary" size="20" />
      </template>
      {{ loadingText }}
    </v-alert>

    <!-- Success -->
    <v-alert
      v-else-if="state === AlertState.Success"
      type="success"
      density="compact"
    >
        <v-sheet
            color="transparent"
            elevation="0"
            class="pa-0 ma-0"
            v-html="success">
        </v-sheet>
    </v-alert>

    <!-- Error -->
    <v-alert
      v-else-if="state === AlertState.Error"
      type="error"
      density="compact"
    >
        <v-sheet
            color="transparent"
            elevation="0"
            class="pa-0 ma-0"
            v-html="error">
        </v-sheet>
    </v-alert>

</v-sheet>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { AlertState } from "../types/AlertState"; // You define this enum

const props = defineProps<{
  state: AlertState;
  success?: string;
  error?: string;
  loadingText?: string;
}>();

const root = ref<HTMLElement | null>(null);

// Scroll into view whenever the alert becomes visible
watch(
  () => props.state,
  async (newState) => {
    if (newState === AlertState.Idle) return;

    await nextTick(); // wait for DOM update

    root.value?.$el?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
);
</script>
