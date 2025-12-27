<template>
  <v-autocomplete
    :items="users"
    :loading="loading"
    :item-title="getFullName"
    item-value="id"
    v-model="internalValue"
    :label="label"
    :clearable="clearable"
    :multiple="multiple"
    v-bind="$attrs"
  >
    <!-- Dropdown items -->
    <template #item="{ props, item }">
      <v-list-item v-bind="props">
        <template #prepend>
          <v-avatar size="32" color="light-blue">
            <img
              :src="item.raw.imageUrl"
              :alt="getAlt(item.raw)"
            />
          </v-avatar>
        </template>
        <v-list-item-title>
          {{ getFullName(item.raw) }}
        </v-list-item-title>
      </v-list-item>
    </template>

    <!-- Selected item(s) -->
    <template #selection="{ item }">
      <v-chip>
        <template #prepend>
          <v-avatar start size="24" color="light-blue">
            <img
              :src="item.raw.imageUrl"
              :alt="getAlt(item.raw)"
            />
          </v-avatar>
        </template>
        {{ getFullName(item.raw) }}
      </v-chip>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { computed } from "vue";

// Do not apply the style elements to the overall element
defineOptions({ inheritAttrs: false })

interface Person {
  id: number;
  firstName: string;
  lastName: string;
  imageUrl?: string;
}

const props = defineProps<{
  modelValue: number | number[] | null; // single or multiple
  users: Person[];                      // list of persons passed in
  label?: string;                       // configurable label
  clearable?: boolean;                  // configurable clearable
  multiple?: boolean;                   // single vs multiple select
  loading?: boolean;                    // allow parent to control loading state
}>();

const emit = defineEmits(["update:modelValue"]);

// Internal binding for v-model
const internalValue = computed({
  get: () => props.modelValue ?? (props.multiple ? [] : null),
  set: (val) => emit("update:modelValue", val),
});

// Helper: full name
function getFullName(person: Person): string {
  return `${person.firstName} ${person.lastName}`;
}

// Helper: alt text (first + last initial)
function getAlt(person: Person): string {
  return `${person.firstName?.charAt(0) ?? ""}${person.lastName?.charAt(0) ?? ""}`;
}
</script>
