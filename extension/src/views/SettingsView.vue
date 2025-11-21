<template>
      <SetupGuard>
        <BaseLayout>
            <template #title>🛠 Settings</template>

            <div v-if="loading">
              <div class="text-muted">Checking access rights…</div>
            </div>

            <div v-else-if="isAdmin">
              <SettingsForm
                :extension-data="extensionData"
                :category-name="AppConfig.SETTINGS_CATEGORY"
              />
            </div>

            <div v-else class="alert alert-danger mt-3">
              ❌ You do not have permission to view or edit the settings.
            </div>
        </BaseLayout>
    </SetupGuard>
</template>


<script setup lang="ts">
import SetupGuard from '../layouts/SetupGuard.vue';
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
