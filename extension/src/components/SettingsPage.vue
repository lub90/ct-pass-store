<template>
    <BaseLayout>
        <template #title>🛠 Settings</template>
        <template #subtitle>Manage the CtPassStore extension</template>

        <!-- While loading the settings and checking access rights -->
        <v-alert
          v-if="loading"
          type="info"
          density="compact"
          class="mx-auto my-4"
          max-width="1200"
          >
          <template #prepend>
              <v-progress-circular indeterminate color="primary" size="20" />
          </template>
          Checking access rights...
        </v-alert>

        <v-alert
          v-if="!isAdmin"
          type="error"
          density="compact"
          class="mx-auto my-4">
          You do not have permission to view or edit the settings.
        </v-alert>


        <v-sheet v-if="isAdmin">
          <SettingsForm
            :extension-data="extensionData"
            :category-name="AppConfig.SETTINGS_CATEGORY"
          />
        </v-sheet>
    </BaseLayout>
</template>


<script setup lang="ts">
import BaseLayout from '../layouts/BaseLayout.vue';
import { inject, ref, onMounted } from 'vue';
import SettingsForm from '../components/SettingsForm.vue';
import { ExtensionData } from '../api/ExtensionData';
import { Permissions } from '../api/Permissions';
import { AppConfig } from '../AppConfig';



const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
const permissions = new Permissions(churchtoolsClient);

const isAdmin = ref(false);
const loading = ref(true);

onMounted(async () => {
  try {
    const category = await extensionData.getCategoryByName(AppConfig.SETTINGS_CATEGORY);
    const canEdit = await permissions.canEditCustomDataForCategory(category.id);

    isAdmin.value = canEdit;

  } catch (error) {
    console.warn('Could not verify admin rights:', error);
  } finally {
    loading.value = false;
  }
});

</script>
