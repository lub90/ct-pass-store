<template>
  <BaseLayout>
    <template #title>🛠 Settings</template>
    <template #subtitle>Manage the CtPassStore extension</template>

    <LoadingGuard :state="loadState" :error="loadError" loading-text="Checking access rights...">

      <!-- Access denied -->
      <v-alert
        v-if="!isAdmin"
        type="error"
        density="compact"
        class="mx-auto my-4"
      >
        You do not have permission to view or edit the settings.
      </v-alert>

      <!-- Settings form -->
      <v-sheet
        v-else
        color="transparent"
        elevation="0"
        class="pa-0 ma-0"
      >
        <SettingsForm />
      </v-sheet>

    </LoadingGuard>
  </BaseLayout>
</template>

<script setup lang="ts">
import { ref, inject } from 'vue';
import BaseLayout from '../layouts/BaseLayout.vue';
import SettingsForm from '../components/settingsPage/SettingsForm.vue';
import { ExtensionData } from '@/ct-extension-utils/lib/ExtensionData';
import { Permissions } from '@/ct-extension-utils/lib/Permissions';
import { AppConfig } from '../AppConfig';
import LoadingGuard from '@/ct-extension-utils/components/LoadingGuard.vue';
import { loadWithState } from '@/ct-extension-utils/composables/loadWithState';

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
const permissions = new Permissions(churchtoolsClient, AppConfig.EXTENSION_KEY);

const isAdmin = ref(false);

const { state: loadState, error: loadError } = loadWithState(async () => {
  const category = await extensionData.getCategoryByName(AppConfig.SETTINGS_CATEGORY);
  const canEdit = await permissions.canEditCustomDataForCategory(category.id);
  isAdmin.value = canEdit;
});
</script>
