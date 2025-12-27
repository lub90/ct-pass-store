<template>

  <LoadingGuard :state="loadState" :error="loadError" loading-text="Loading settings...">

    <v-form @submit.prevent="handleSave">

      <!-- Feedback and settings messages -->
      <AlertMessages
        :state="alertState"
        :success="successMessage"
        :error="errorMessage"
        loading-text="Setting new password - please wait..."
      />

      <!-- Require primary password -->
      <v-switch
        v-model="settings.requirePasswordForPasswordChange"
        color='success'
        label="Require primary password for secondary password change"
        inset
      />

      <!-- Allow custom passwords -->
      <v-tooltip text="If enabled, users can choose their own passwords. If disabled, passwords will be generated automatically and can only be reset by the users.">
        <template #activator="{ props }">
          <v-switch
            v-model="settings.allowCustomPassword"
            color='success'
            label="Allow custom passwords"
            inset
            v-bind="props"
          />
        </template>
      </v-tooltip>

      <!-- Admin user IDs -->
      <v-tooltip text="Admin users can read, set and/or reset the secondary password for other users. Use this feature carefully!">
        <template #activator="{ props }">
          <PersonSelect
            v-model="settings.adminUsers"
            :users="persons"
            label="Admin users"
            :clearable=true
            :multiple=true
            v-bind="props"
            class="mb-4"
          />
        </template>
      </v-tooltip>


      <!-- Read access user IDs -->
      <v-tooltip text="Read access users can read the secondary password for other users. Use this feature carefully!">
        <template #activator="{ props }">
          <PersonSelect
            v-model="settings.readAccessUsers"
            :users="persons"
            label="Read access users"
            :clearable=true
            :multiple=true
            v-bind="props"
            class="mb-4"
          />
        </template>
      </v-tooltip>

      <!-- Minimum password length -->
      <v-tooltip text="Must be greater than 8.">
        <template #activator="{ props }">
          <v-text-field
            v-model.number="settings.passwordLength"
            type="number"
            min="8"
            label="Minimum password length"
            variant="outlined"
            density="comfortable"
            v-bind="props"
            :rules="[
              v => !!v || 'Value is required',
              v => v >= 8 || 'Value must be at least 8'
            ]"
            class="mb-4"
          />
        </template>
      </v-tooltip>

      <!-- Backend URL -->
      <UrlInput
        v-model="settings.backendUrl"
        label="PHP Backend URL"
        tooltip='Including "https://..."'
        variant="outlined"
        density="comfortable"
        class="mb-4"
      />

      <!-- Submit button -->
      <v-btn
        type="submit"
        color="primary">
        <v-icon start>mdi-content-save</v-icon>
        Save Settings
      </v-btn>
    </v-form>
  </LoadingGuard>
</template>


<script setup lang="ts">
import { ref, inject, computed, watch, reactive } from 'vue';
import { ExtensionData } from '@/ct-extension-utils/lib/ExtensionData';
import UrlInput from './UrlInput.vue';
import { AppConfig } from '../../AppConfig';
import { loadWithState } from '@/ct-extension-utils/composables/loadWithState';
import LoadingGuard from '@/ct-extension-utils/components/LoadingGuard.vue';
import { AlertState } from '@/ct-extension-utils/types/AlertState'
import AlertMessages from '@/ct-extension-utils/components/AlertMessages.vue'
import type { Person } from '../../utils/ct-types.d.ts';
import PersonSelect from "@/ct-extension-utils/components/PersonSelect.vue";

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

const emit = defineEmits<{
  (e: 'saved', payload: Record<string, any>): void;
  (e: 'error', error: unknown): void;
}>();

// Settings related variables
const settings = reactive({
  requirePasswordForPasswordChange: true,
  allowCustomPassword: true,
  adminUsers: [] as number[],
  readAccessUsers: [] as number[],
  passwordLength: 12,
  backendUrl: "",
});

// All persons that can be selected
const persons = ref<Person[]>([]);

// Form related variables
const saving = ref(false);
const successMessage = ref('');
const errorMessage = ref('');
const alertState = computed(() => {
  if (saving.value) return AlertState.Loading;
  if (errorMessage.value) return AlertState.Error;
  if (successMessage.value) return AlertState.Success;
  return AlertState.Idle;
});

// Let success message disappear as soon as somebody types something new
watch(settings, () => {
  successMessage.value = '';
  errorMessage.value = '';
}, { deep: true });

const { state: loadState, error: loadError } = loadWithState(async () => {
  await loadSettings();
  await loadAllUsers();
});

async function loadSettings() {
  try {
    const hasData = await extensionData.categoryHasData(AppConfig.SETTINGS_CATEGORY);
    if (hasData) {
      const entry = await extensionData.getCategoryData(AppConfig.SETTINGS_CATEGORY, true);
      const values = JSON.parse(entry.value);
      Object.assign(settings, values);
    }
  } catch (error) {
    console.warn('Could not load existing settings:', error);
  }
}

async function loadAllUsers() {
    const loadedPersons: Person[] = await churchtoolsClient.getAllPages("/persons");
    persons.value = loadedPersons;
}

async function handleSave() {
  saving.value = true;

  try {
    const hasData = await extensionData.categoryHasData(AppConfig.SETTINGS_CATEGORY);

    if (hasData) {
      const existing = await extensionData.getCategoryData(AppConfig.SETTINGS_CATEGORY);
      if (existing.length > 0) {
        const entry = existing[0];
        await extensionData.updateCategoryEntry(AppConfig.SETTINGS_CATEGORY, entry.id, settings);
      } else {
        await extensionData.createCategoryEntry(AppConfig.SETTINGS_CATEGORY, settings);
      }
    } else {
      await extensionData.createCategoryEntry(AppConfig.SETTINGS_CATEGORY, settings);
    }

    // Success message
    successMessage.value = 'Settings were successfully saved.';

    emit('saved', settings);
  } catch (error) {
    errorMessage.value = 'Failed to save settings. See console for further details.';
    console.error('Failed to save settings:', error);
    emit('error', error);
  }

  saving.value = false;
}

</script>
