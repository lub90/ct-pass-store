<template>
  <v-sheet color="transparent" class="d-flex flex-column mt-10">
    <div class="text-body-2 text-muted mb-2">
      You are required to enter your primary ChurchTools password in order to reset your secondary password.
    </div>

    <v-input>
      <template #prepend>
        <p class="text-body-1 font-weight-medium" style="width:170px;">
          Primary Password:
        </p>
      </template>

      <v-text-field
        v-model="internalValue"
        :rules="rules"
        type="password"
        label="Your primary ChurchTools password"
        placeholder="Your primary ChurchTools password"
        variant="outlined"
        density="comfortable"
        style="max-width: 400px;"
      />
    </v-input>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits(["update:modelValue", "valid"]);

const internalValue = ref(props.modelValue);
const isValid = computed(() => internalValue.value?.trim() !== "");

// Sync internal → parent
watch(internalValue, (val) => emit("update:modelValue", val));

// Sync parent → internal
watch(
  () => props.modelValue,
  (val) => {
    if (val !== internalValue.value) internalValue.value = val;
  }
);

// Validation rule
const rules = [
  (v: string) =>
    isValid.value ||
    `Primary password is not allowed to be empty!`
];

// Emit validity to parent
watch(isValid, (val) => emit("valid", val), { immediate: true });
</script>
