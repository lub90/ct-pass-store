<template>
  <!-- Security warning -->
    <v-alert
      v-if="isInsecure"
      type="error"
      density="compact"
      class="mb-2"
      icon="mdi-alert"
    >
      Communication with the backend must use HTTPS. HTTP is not secure and should only be used in local, secured testing environments.
    </v-alert>

  <v-tooltip :text="tooltip">
    <template #activator="{ props: tooltipProps }">
      <v-text-field
        v-bind="{ ...$attrs, ...tooltipProps }"
        v-model="internalValue"
        :label="label"
        :variant="variant"
        :density="density"
        :rules="rules"
      />
    </template>
  </v-tooltip>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";

// Do not try to apply styles to the root element
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue: string;
  label: string;
  tooltip: string;
  variant?: string;
  density?: string;
}>();

const emit = defineEmits(["update:modelValue"]);

// internal state
const internalValue = ref(props.modelValue);

// Chec if https is used
const isInsecure = computed(() => {
  return internalValue.value?.startsWith("http://");
});


// sync parent → internal
watch(
  () => props.modelValue,
  (val) => {
    if (val !== internalValue.value) internalValue.value = val;
  }
);

// sync internal → parent
watch(internalValue, (val) => emit("update:modelValue", val));

// URL validation rule
const rules = [
  (v: string) => {
    if (!v) return "URL is required";

    if (!/^https?:\/\//i.test(v)) {
      return "URL must start with http:// or https://";
    }

    try {
      new URL(v);
      return true;
    } catch {
      return "Please enter a valid URL";
    }
  }
];
</script>
