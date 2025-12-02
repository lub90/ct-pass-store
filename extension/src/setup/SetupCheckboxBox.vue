<template>
  <div
    :class="[
      'alert',
      checked ? 'alert-success' : 'alert-danger',
      'd-flex',
      'align-items-start',
      'gap-2',
      'py-2',
      'px-3',
      'mb-3'
    ]"
  >
    <i
      :class="[
        'bi',
        checked ? 'bi-check-circle-fill text-success mt-1' : 'bi-exclamation-circle-fill text-danger mt-1'
      ]"
    ></i>
    <div>
      <div v-html="content" class="mb-2" />
      <div class="form-check">
        <input
          class="form-check-input"
          type="checkbox"
          :id="checkboxId"
          v-model="checked"
        />
        <label class="form-check-label" :for="checkboxId">
          {{ label }}
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, defineEmits } from 'vue';

const props = defineProps<{
  content: string;
  label: string;
  modelValue: boolean;
  checkboxId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const checked = ref(props.modelValue);

watch(checked, (val) => {
  emit('update:modelValue', val);
});
</script>
