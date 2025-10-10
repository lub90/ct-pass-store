<template>
  <li class="list-group-item d-flex align-items-center">
    <i :class="iconClass" class="me-2" />
    <span :class="textClass">{{ precondition.description }}</span>
  </li>
</template>

<script setup lang="ts">
import type { Precondition } from '../types/Precondition';
import { computed } from 'vue';

const props = defineProps<{
    precondition: Precondition
}>();

const iconClass = computed(() =>
  props.precondition.fulfilled ? 'bi bi-check-circle-fill text-success' : 'bi bi-x-circle-fill text-danger'
);

const textClass = computed(() =>
  props.precondition.fulfilled ? 'text-success' : 'text-danger'
);
</script>
