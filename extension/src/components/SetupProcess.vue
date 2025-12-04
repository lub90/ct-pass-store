<template>
  <v-sheet>
    <!-- List of process statuses -->
    <v-card>
      <SetupProcessList :elements="elements" />
    </v-card>

    <!-- Result alert -->
    <v-alert
      v-if="allResolved"
      :type="allSuccessful ? 'success' : 'error'"
      density="compact"
      class="d-flex align-center gap-2 py-2 px-3 mb-3 font-weight-semibold mt-4"
    >
      <span v-if="allSuccessful">
        {{successMessage}}
      </span>
      <span v-else>
        {{failMessage}}
      </span>
    </v-alert>
  </v-sheet>
</template>

<script setup lang="ts">
import { watch, computed } from 'vue';
import SetupProcessList from './SetupProcessList.vue';
import { SetupProcessElement } from '../types/SetupProcessElement';

const emit = defineEmits<{
  (e: 'complete'): void
}>()


const props = defineProps<{
    elements: SetupProcessElement[];
    successMessage: string;
    failMessage: string;
}>()


const allResolved = computed(() =>
  props.elements.every(e => !e.resultPending.value)
)
const allSuccessful = computed(() =>
  allResolved.value &&
  props.elements.every(
    e => !e.resultPending.value && e.result.successful
  )
)

// Emit when all are fulfilled
watch(allSuccessful, (val) => {
  if (val) emit('complete')
})

</script>
