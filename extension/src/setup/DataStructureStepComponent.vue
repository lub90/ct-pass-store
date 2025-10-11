<template>
  <div>
    <p>Setting up the data structure…</p>

    <ul class="list-group mb-3">
      <li
        v-for="(status, index) in statusItems"
        :key="index"
        class="list-group-item d-flex align-items-center gap-2"
        :class="status.variant ? `text-${status.variant}` : ''"
      >
        <span v-if="status.pending" class="spinner-border spinner-border-sm text-secondary" role="status" />
        <i v-else :class="`bi ${status.icon}`"></i>
        <span>{{ status.message }}</span>
      </li>
    </ul>

    <div v-if="finished" :class="['alert', allOkay ? 'alert-success' : 'alert-danger']" class="d-flex align-items-center gap-2 py-2 px-3 mb-3 fw-semibold">
      <span v-if="allOkay">✓ All data structures were generated. Please continue with the next step.</span>
      <span v-else>✗ Unable to generate necessary data structures. Cannot conintue with setup!</span>
    </div>

  </div>
</template>

<script setup lang="ts">

import { ref, onMounted } from 'vue';
import { inject } from 'vue';
import { defineEmits } from 'vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig'

const churchtoolsClient = inject('churchtoolsClient');

const emit = defineEmits<{
    (e: 'completed'): void;
}>();


type StatusItem = {
  pending: boolean;
  message: string;
  icon?: string;
  variant?: 'success' | 'danger';
};

const statusItems = ref<StatusItem[]>([]);
const finished = ref(false);
const allOkay = ref(false);

onMounted(async () => {
  const extensionData: ExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

  await setupSettings(extensionData);
  await setupInternalSettings(extensionData);
  await setupPasswordStore(extensionData);

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
    AppConfig.INTERNAL_SETTINGS_SHORTY,
    AppConfig.INTERNAL_SETTINGS_CATEGORY_SCHEMA,
    "Constants"
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
