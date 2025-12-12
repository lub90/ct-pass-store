<template>
  <v-form @submit.prevent="handleSave">
    <!-- Success alert -->
    <v-alert
      v-if="saved"
      type="success"
      density="compact"
    >
      Settings were successfully saved.
    </v-alert>

    <!-- Require primary password -->
    <v-switch
      v-model="requireOldPassword"
      color='success'
      label="Require primary password for secondary password change"
      inset
    />

    <!-- Allow custom passwords -->
    <v-tooltip text="If enabled, users can choose their own passwords. If disabled, passwords will be generated automatically and can only be reset by the users.">
      <template #activator="{ props }">
        <v-switch
          v-model="allowCustomPassword"
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
        <v-text-field
          v-model="adminUserInput"
          label="Admin user IDs (comma-separated)"
          variant="outlined"
          density="comfortable"
          v-bind="props"
        />
      </template>
    </v-tooltip>


    <!-- Read access user IDs -->
    <v-tooltip text="Read access users can read the secondary password for other users. Use this feature carefully!">
      <template #activator="{ props }">
        <v-text-field
          v-model="readAccessUserInput"
          label="Read access user IDs (comma-separated)"
          variant="outlined"
          density="comfortable"
          v-bind="props"
        />
      </template>
    </v-tooltip>

    <!-- Minimum password length -->
    <v-tooltip text="Must be greater than 8.">
      <template #activator="{ props }">
        <v-text-field
          v-model.number="passwordLength"
          type="number"
          min="8"
          label="Minimum password length"
          variant="outlined"
          density="comfortable"
          v-bind="props"
        />
      </template>
    </v-tooltip>

    <!-- Backend URL -->
    <v-tooltip text='Including "https://...".'>
      <template #activator="{ props }">
        <v-text-field
          v-model="backendUrl"
          label="PHP Backend URL"
          variant="outlined"
          density="comfortable"
          v-bind="props"
        />
      </template>
    </v-tooltip>

    <!-- Submit button -->
    <v-btn
      type="submit"
      color="primary">
      <v-icon start>mdi-content-save</v-icon>
      Save Settings
    </v-btn>
  </v-form>
</template>


<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ExtensionData } from '../api/ExtensionData';

const props = defineProps<{
  extensionData: ExtensionData;
  categoryName: string;
}>();

const emit = defineEmits<{
  (e: 'saved', payload: Record<string, any>): void;
  (e: 'error', error: unknown): void;
}>();

const requireOldPassword = ref(true);
const allowCustomPassword = ref(true);
const adminUserInput = ref('');
const readAccessUserInput = ref('');
const passwordLength = ref(12);
const backendUrl = ref('');
const saved = ref(false);

onMounted(async () => {
  try {
    const hasData = await props.extensionData.categoryHasData(props.categoryName);
    if (hasData) {
      const entry = await props.extensionData.getCategoryData(props.categoryName, true);
      const values = JSON.parse(entry.value);
      requireOldPassword.value = values.requirePasswordForPasswordChange ?? true;
      allowCustomPassword.value = values.allowCustomPassword ?? true;
      adminUserInput.value = (values.adminUsers ?? []).join(', ');
      readAccessUserInput.value = (values.readAccessUsers ?? []).join(', ');
      passwordLength.value = values.passwordLength ?? 12;
      backendUrl.value = values.backendUrl ?? '';
    }
  } catch (error) {
    console.warn('Could not load existing settings:', error);
  }
});

async function handleSave() {
  const adminUsers = adminUserInput.value
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id) && id >= 1);

  const readAccessUsers = readAccessUserInput.value
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id) && id >= 1);

  const payload = {
    requirePasswordForPasswordChange: requireOldPassword.value,
    allowCustomPassword: allowCustomPassword.value,
    adminUsers,
    readAccessUsers,
    passwordLength: passwordLength.value,
    backendUrl: backendUrl.value,
  };

  try {
    const hasData = await props.extensionData.categoryHasData(props.categoryName);

    if (hasData) {
      const existing = await props.extensionData.getCategoryData(props.categoryName);
      if (existing.length > 0) {
        const entry = existing[0];
        await props.extensionData.updateCategoryEntry(props.categoryName, entry.id, payload);
      } else {
        await props.extensionData.createCategoryEntry(props.categoryName, payload);
      }
    } else {
      await props.extensionData.createCategoryEntry(props.categoryName, payload);
    }

    saved.value = true;
    emit('saved', payload);
  } catch (error) {
    console.error('Failed to save settings:', error);
    emit('error', error);
  }
}

</script>
