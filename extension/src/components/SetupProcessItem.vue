<template>
  <v-list-item>
    <template #prepend>
      <v-icon
      :color="iconColor"
      :class="{ 'mdi-spin': loading }"
      >
        {{ icon }}
      </v-icon>
    </template>
    <v-list-item-title :class="textColor">
      {{ message }}
    </v-list-item-title>
  </v-list-item>
</template>

<script setup lang="ts">
import type { SetupProcessElement } from '../types/SetupProcessElement'
import { computed } from 'vue'

const props = defineProps<{
  element: SetupProcessElement
}>()

// TODO: We need this due to a very strange error we sometimes have, if we add SetupProcessElements dynamically to the SetupProcessList
// props.element.resultPending.value is then always undefined, but changes still trigger a reevaluation. As such, we also test for props.element.result.successful not to be undefined...
const loading = computed(() => {
  return props.element.resultPending.value || (props.element.result.successful === undefined);
})

const icon = computed(() => {
  if (loading.value) {
    return 'mdi-loading' // spinner icon
  }
  return props.element.result.successful ? 'mdi-check-circle' : 'mdi-close-circle'
})

const message = computed(() => {
  if (loading.value) {
    return props.element.waitingMessage
  }
  return props.element.result.message
})


const iconColor = computed(() => {
  if (loading.value) {
    return 'info' // blue while loading
  }
  return props.element.result.successful ? 'success' : 'error'
})

const textColor = computed(() => {
  if (loading.value) {
    return 'text-info'
  }
  return props.element.result.successful ? 'text-success' : 'text-error'
})
</script>
