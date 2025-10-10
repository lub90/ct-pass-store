<template>
  <div>
    <p class="alert alert-info d-flex align-items-center gap-2 py-2 px-3 mb-3 fw-semibold">
      The extension has not been set up yet. Starting setup and checking preconditions…
    </p>

    <ul class="list-group mb-3">
      <PreconditionItem
        v-for="(p, index) in flatPreconditions"
        :key="index"
        :precondition="p"
      />
    </ul>

    <p>
      <strong v-if="allFulfilled">✅ All preconditions fulfilled. You can start the setup.</strong>
      <strong v-else>❌ Some preconditions are not fulfilled. You are not authorized to run the setup.</strong>
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import PreconditionItem from './PreconditionItem.vue';
import type { Precondition } from '../types/Precondition';

const props = defineProps<{
  steps: SetupStep[]; // array of component refs with checkPrecondition()
}>();

const emit = defineEmits<{
  (e: 'complete'): void;
}>();

const flatPreconditions = ref<Precondition[]>([]);
const allFulfilled = computed(() =>
  flatPreconditions.value.length > 0 &&
  flatPreconditions.value.every(p => p.fulfilled)
);

onMounted(async () => {
  const results = await Promise.all(
    props.steps.map(step => step.checkPrecondition())
  );
  console.log(results);
  flatPreconditions.value = results.flat();

  if (allFulfilled.value) {
    emit('complete');
  }
});
</script>
