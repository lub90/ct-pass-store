<template>
  <v-list density="compact">
    <template v-for="(element, index) in elements" :key="index">
      <!-- Fulfilled / not fulfilled -->
      <SetupProcessItem :element="element" />
    </template>
  </v-list>
</template>

<script setup lang="ts">
import SetupProcessItem from './SetupProcessItem.vue'
import type { SetupProcessElement } from '../types/SetupProcessElement'

const props = defineProps<{
  elements: SetupProcessElement[]
}>()
</script>
