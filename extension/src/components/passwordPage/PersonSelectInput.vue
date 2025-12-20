<template>
  <v-sheet class="mt-6">
    <v-input>
      <template #prepend>
        <p class="text-body-1 font-weight-medium" style="width:170px;">
          Select Person:
        </p>
      </template>

      <PersonSelect
        v-model="internalValue"
        :users="users"
        :rules="rules"
        label="Select the person whose password you want to change"
        style="max-width: 400px;"
      />
    </v-input>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import PersonSelect from "../PersonSelect.vue";
import type { Person } from "../utils/ct-types.d.ts";

const props = defineProps<{
  modelValue: number | null;
  users: Person[];
}>();

const emit = defineEmits(["update:modelValue"]);

// Internal state
const internalValue = ref(props.modelValue);

// Sync internal → parent
watch(internalValue, (val) => emit("update:modelValue", val));

// Sync parent → internal
watch(
  () => props.modelValue,
  (val) => {
    if (val !== internalValue.value) internalValue.value = val;
  }
);

// Validation rule: must select a person
const rules = [
  (v: number | null) => !!v || "Please select a person"
];
</script>
