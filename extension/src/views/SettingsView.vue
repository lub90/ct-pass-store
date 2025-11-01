<template>
      <SetupGuard>
        <BaseLayout>
            <template #title>🛠 Settings</template>
            <SettingsForm
              :extension-data="extensionData"
              :category-name="AppConfig.SETTINGS_CATEGORY"
            />
        </BaseLayout>
    </SetupGuard>
</template>


<script setup lang="ts">
import SetupGuard from '../layouts/SetupGuard.vue';
import BaseLayout from '../layouts/BaseLayout.vue';
import { inject, defineEmits } from 'vue';
import SettingsForm from '../components/SettingsForm.vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';


const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
</script>
