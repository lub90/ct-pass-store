<template>
  <div>
    <p class="mb-3 fw-semibold">
      The extension has not been set up yet. Checking preconditions to start setup…
    </p>

    <ul class="list-group mb-3">
      <template v-for="(status, index) in preconditionStatuses" :key="index">
        <li v-if="status.pending" class="list-group-item d-flex align-items-center gap-2">
          <span class="spinner-border spinner-border-sm text-secondary" role="status" />
          <span>Checking precondition {{ index + 1 }}…</span>
        </li>
        <PreconditionItem
          v-else
          :precondition="status.precondition"
        />
      </template>
    </ul>

    <div v-if="allResolved" :class="['alert', allFulfilled ? 'alert-success' : 'alert-danger']" class="d-flex align-items-center gap-2 py-2 px-3 mb-3 fw-semibold">
      <span v-if="allFulfilled">✓ All preconditions fulfilled. You can start the setup.</span>
      <span v-else>✗ Some preconditions are not fulfilled. Setup cannot be started.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import PreconditionItem from './PreconditionItem.vue';
import type { Precondition } from '../types/Precondition';

const props = defineProps<{
  steps: SetupStep[]; // array of component refs with checkPrecondition()
}>();

// Final signal if everything is okay
const emit = defineEmits<{
  (e: 'complete'): void;
}>();

// Check current checking status...
type PreconditionStatus =
  | { pending: true }
  | { pending: false; precondition: Precondition };


// The current status of precondition checking...
const preconditionStatuses = ref<PreconditionStatus[]>([]);
const allResolved = computed(() =>
  preconditionStatuses.value.every(p => !p.pending)
);
const allFulfilled = computed(() =>
  allResolved.value &&
  preconditionStatuses.value.every(
    p => !p.pending && p.precondition.fulfilled
  )
);

onMounted(async () => {

  for (const step of props.steps) {
    // Zeige Spinner
    preconditionStatuses.value.push({ pending: true });

    const result = await step.checkPrecondition();

    // Entferne Spinner
    preconditionStatuses.value.pop();

    // Füge echte Ergebnisse ein
    preconditionStatuses.value.push(...result.map(p => ({
      pending: false,
      precondition: p,
    })));
  }

  if (allFulfilled.value) {
    emit('complete');
  }

});
</script>
