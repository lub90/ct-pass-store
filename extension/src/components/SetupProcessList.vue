<template>
  <v-list density="compact">
    <template v-for="(status, index) in setupProcessStatuses" :key="index">
      <!-- Pending state -->
      <v-list-item v-if="status.pending">
        <template #prepend>
          <v-progress-circular indeterminate size="20" class="me-3" />
        </template>
        <v-list-item-title>
          Running setup step {{ index + 1 }}...
        </v-list-item-title>
      </v-list-item>

      <!-- Fulfilled / not fulfilled -->
      <SetupProcessItem
        v-else
        :setupStatus="status.setupStatus"
      />
    </template>
  </v-list>
</template>

<script setup lang="ts">
import SetupProcessItem from './SetupProcessItem.vue'
import type { SetupProcessStatus } from '../types/SetupProcessStatus'

interface SetupProcessItemStatus {
  pending: boolean
  setupStatus: SetupProcessStatus
}

const props = defineProps<{
  setupProcessStatuses: SetupProcessItemStatus[]
}>()
</script>
