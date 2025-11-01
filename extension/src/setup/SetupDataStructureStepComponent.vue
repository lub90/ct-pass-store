
<template>
    <SetupStep title="Setting up the data structure…">
        <SetupStatusList :items="statusItems" />

        <SetupResultBox
            :finished="finished"
            :all-okay="allOkay"
            success-message="✓ All data structures were generated. Please continue with the next step."
            error-message="✗ Unable to generate necessary data structures. Cannot continue with setup!"
        />

    </SetupStep>
</template>

<script setup lang="ts">
import SetupStep from './SetupStep.vue';
import SetupStatusList from './SetupStatusList.vue';
import SetupResultBox from './SetupResultBox.vue';
import SetupInfoBox from './SetupInfoBox.vue';
import type { StatusItem } from './SetupStatusList.vue';
import { ref, onMounted } from 'vue';
import { inject } from 'vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig'


const churchtoolsClient = inject('churchtoolsClient');
const statusItems = ref<StatusItem[]>([]);
const finished = ref(false);
const allOkay = ref(false);


const emit = defineEmits<{
    (e: 'completed'): void;
}>();

onMounted(async () => {
  const extensionData: ExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

  await setupSettings(extensionData);
  await setupInternalSettings(extensionData);
  await setupPasswordStore(extensionData);
  await setupSetupCompleted(extensionData);

  // Generate an update extension data set
  const updatedExtensionData: ExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

  if ((await updatedExtensionData.hasCategory(AppConfig.SETTINGS_CATEGORY))
    && (await updatedExtensionData.hasCategory(AppConfig.INTERNAL_SETTINGS_CATEGORY))
    && (await updatedExtensionData.hasCategory(AppConfig.PASSWORD_STORE_CATEGORY))
  ) {
    allOkay.value = true;
    emit('completed');
  }

  finished.value = true;
    
});

async function setupSettings(extensionData: ExtensionData) {
await setupDataStructure(
    extensionData,
    AppConfig.SETTINGS_CATEGORY,
    AppConfig.SETTINGS_CATEGORY_SHORTY,
    AppConfig.SETTINGS_CATEGORY_SCHEMA,
    "Settings"
  );
}

async function setupInternalSettings(extensionData: ExtensionData) {
await setupDataStructure(
    extensionData,
    AppConfig.INTERNAL_SETTINGS_CATEGORY,
    AppConfig.INTERNAL_SETTINGS_CATEGORY_SHORTY,
    AppConfig.INTERNAL_SETTINGS_SCHEMA,
    "Constants"
  );
}

async function setupSetupCompleted(extensionData: ExtensionData) {
await setupDataStructure(
    extensionData,
    AppConfig.SETUP_COMPLETED_CATEGORY,
    AppConfig.SETUP_COMPLETED_CATEGORY_SHORTY,
    AppConfig.SETUP_COMPLETED_SCHEMA,
    "Flags"
  );
}

async function setupPasswordStore(extensionData: ExtensionData) {
  await setupDataStructure(
    extensionData,
    AppConfig.PASSWORD_STORE_CATEGORY,
    AppConfig.PASSWORD_STORE_CATEGORY_SHORTY,
    AppConfig.PASSWORD_STORE_SCHEMA,
    "Password Database"
  );
}


async function setupDataStructure(extensionData: ExtensionData, category: string, categoryShorty: string, categorySchema: string, displayName: string) {
  statusItems.value.push({
    pending: true,
    message: `Creating ${displayName}...`,
  });

  try {

    if (!(await extensionData.hasCategory(category))) {
      await extensionData.createCategory(
        category,
        categoryShorty,
        categorySchema,
        `Stores extension ${displayName}`
      );

      statusItems.value.splice(-1, 1, {
        pending: false,
        message: `${displayName} created successfully.`,
        icon: 'bi-check-circle-fill text-success',
        variant: 'success',
      });
    } else {
      statusItems.value.splice(-1, 1, {
        pending: false,
        message: `${displayName} already exist. No need to create them...`,
        icon: 'bi-check-circle-fill text-success',
        variant: 'success',
      });
    }
  } catch (error) {
    statusItems.value.splice(-1, 1, {
      pending: false,
      message: `Failed to create ${displayName}. See console for details.`,
      icon: 'bi-x-circle-fill text-danger',
      variant: 'danger',
    });
    console.error(`Creation of ${displayName} failed:`, error);
  }
}


</script>
