<template>
  <v-sheet>
    <!-- List of process statuses -->
    <v-card>
      <SetupProcessList :setupProcessStatuses="setupStatuses" />
    </v-card>

    <!-- Result alert -->
    <v-alert
      v-if="allResolved"
      :type="allFulfilled ? 'success' : 'error'"
      density="compact"
      class="d-flex align-center gap-2 py-2 px-3 mb-3 font-weight-semibold mt-4"
    >
      <span v-if="allFulfilled">
        {{successMessage}}
      </span>
      <span v-else>
        {{failMessage}}
      </span>
    </v-alert>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import SetupProcessList from './SetupProcessList.vue';
import { SetupProcessStatus } from '../types/SetupProcessStatus';

const emit = defineEmits<{
  (e: 'complete'): void
}>()


const props = defineProps<{
    steps: Promise<SetupProcessStatus>[];
    successMessage: string;
    failMessage: string;
}>();

// Check current checking status...
type SetupProcessStepStatus =
  | { pending: true }
  | { pending: false; setupStatus: SetupProcessStatus };


// The current status of setup process checking...
const setupStatuses = ref<SetupProcessStepStatus[]>([]);
const allResolved = computed(() =>
  setupStatuses.value.every(p => !p.pending)
);
const allFulfilled = computed(() =>
  allResolved.value &&
  setupStatuses.value.every(
    p => !p.pending && p.setupStatus.fulfilled
  )
);

onMounted(() => {
  // Enter all steps as pending
  setupStatuses.value = props.steps.map(() => ({ pending: true }))

  props.steps.forEach((stepPromise, i) => {
    stepPromise.then(result => {
      setupStatuses.value[i] = {
        pending: false,
        setupStatus: result
      }

      // check if all are resolved and fulfilled
      if (allFulfilled.value) {
        emit('complete')
      }
    }).catch(() => {
      // error handling
      setupStatuses.value[i] = {
        pending: false,
        setupStatus: { description: 'Step failed due to unexpected error!', fulfilled: false }
      }
    })
  })
});
</script>
