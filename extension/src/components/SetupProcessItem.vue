<template>
  <v-list-item>
    <template #prepend>
      <v-icon :color="iconColor">
        {{ icon }}
      </v-icon>
    </template>
    <v-list-item-title :class="textColor">
      {{ setupStatus.description }}
    </v-list-item-title>
  </v-list-item>
</template>

<script setup lang="ts">
import type { SetupProcessStatus } from '../types/SetupProcessStatus'
import { computed } from 'vue'

const props = defineProps<{
  setupStatus: SetupProcessStatus   
}>()

const icon = computed(() =>
  props.setupStatus.fulfilled ? 'mdi-check-circle' : 'mdi-close-circle'
)

const iconColor = computed(() =>
  props.setupStatus.fulfilled ? 'success' : 'error'
)

const textColor = computed(() =>
  props.setupStatus.fulfilled ? 'text-success' : 'text-error'
)
</script>
