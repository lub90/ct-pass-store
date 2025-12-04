<template>
  <v-alert
    :type="checked ? 'success' : 'error'"
    density="comfortable"
  >
    <template #prepend>
      <v-icon>
        {{ checked ? 'mdi-check-circle' : 'mdi-alert-circle' }}
      </v-icon>
    </template>

    <!-- Content text -->
    <div>
      <slot />
    </div>

    <!-- Checkbox -->
    <v-checkbox
      v-model="checked"
      :label="label"
      :id="checkboxId"
      hide-details
      density="compact"
    />
  </v-alert>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
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
