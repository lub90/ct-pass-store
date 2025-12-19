<template>
  <v-autocomplete
    :items="users"
    :loading="loading"
    item-title="fullName"
    item-value="id"
    v-model="props.modelValue"
    @update:modelValue="emit('update:modelValue', $event)"
    label="Select user"
    clearable
  >
    <!-- How each item looks in the dropdown -->
    <template #item="{ props, item }">
      <v-list-item v-bind="props">
        <template #prepend>
          <v-avatar size="32" color="light-blue">
            <img
              :src="item.raw.imageUrl"
              :alt="`${item.raw.firstName?.charAt(0) ?? ''}${item.raw.lastName?.charAt(0) ?? ''}`"
            />
          </v-avatar>
        </template>

        <v-list-item-title>
          {{ item.raw.firstName }} {{ item.raw.lastName }}
        </v-list-item-title>
      </v-list-item>
    </template>

    <!-- How the selected item looks in the input -->
    <template #selection="{ item }">
      <v-chip>
        <template #prepend>
            <v-avatar start size="24" color="light-blue">
            <img
                :src="item.raw.imageUrl"
                :alt="`${item.raw.firstName?.charAt(0) ?? ''}${item.raw.lastName?.charAt(0) ?? ''}`"
                />
            </v-avatar>
        </template>
        {{ item.raw.firstName }} {{ item.raw.lastName }}
      </v-chip>
    </template>
  </v-autocomplete>
</template>


<script setup lang="ts">
import { ref, onMounted, inject } from "vue";

interface Person {
  id: number;
  firstName: string;
  lastName: string;
  imageUrl?: string;
}

const props = defineProps<{
  modelValue: number | null;
}>();

const emit = defineEmits(["update:modelValue"]);

// Inject ChurchTools client
const client = inject<any>("churchtoolsClient");

const users = ref<Person[]>([]);
const loading = ref(false);

// Fetch all users with pagination
async function loadAllUsers() {
    loading.value = true;

    const all: Person[] = [];
    const res: Person[] = await client.getAllPages("/persons");

    // If client returns only the array, treat `res` as the page content
    // TODO: Make more consistent check...
    const pageItems = res;
    //if (!pageItems.length) break;

    all.push(
        ...pageItems.map(p => ({
            ...p,
            fullName: `${p.firstName} ${p.lastName}`,
        }))
    );

    users.value = all;
    loading.value = false;
}

onMounted(() => {
  loadAllUsers();
});
</script>

