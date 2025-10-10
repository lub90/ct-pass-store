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
  await setupPasswordStore(extensionData);

  // Generate an update extension data set
  const extensionData2: ExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

  if ((await extensionData2.hasCategory(AppConfig.SETTINGS_CATEGORY)) && (await extensionData2.hasCategory(AppConfig.PASSWORD_STORE_CATEGORY))) {
    allOkay.value = true;
    emit('completed');
  }

  finished.value = true;
    
});

async function setupSettings(extensionData: ExtensionData) {
  statusItems.value.push({
    pending: true,
    message: 'Creating settings...',
  });

  try {

    if (!(await extensionData.hasCategory(AppConfig.SETTINGS_CATEGORY))) {
      await extensionData.createCategory(
        AppConfig.SETTINGS_CATEGORY,
        AppConfig.SETTINGS_CATEGORY_SHORTY,
        AppConfig.SETTINGS_SCHEMA,
        'Stores extension settings'
      );

      statusItems.value.splice(-1, 1, {
        pending: false,
        message: 'Settings created successfully.',
        icon: 'bi-check-circle-fill text-success',
        variant: 'success',
      });
    } else {
      statusItems.value.splice(-1, 1, {
        pending: false,
        message: 'Settings already exist. No need to create them...',
        icon: 'bi-check-circle-fill text-success',
        variant: 'success',
      });
    }
  } catch (error) {
    statusItems.value.splice(-1, 1, {
      pending: false,
      message: 'Failed to create settings. See console for details.',
      icon: 'bi-x-circle-fill text-danger',
      variant: 'danger',
    });
    console.error('Creation of settings failed:', error);
  }
}

async function setupPasswordStore(extensionData: ExtensionData) {
  statusItems.value.push({
    pending: true,
    message: 'Creating password store...',
  });

  try {

    if (!(await extensionData.hasCategory(AppConfig.PASSWORD_STORE_CATEGORY))) {
      await extensionData.createCategory(
        AppConfig.PASSWORD_STORE_CATEGORY,
        AppConfig.PASSWORD_STORE_CATEGORY_SHORTY,
        AppConfig.PASSWORD_STORE_SCHEMA,
        'Stores encrypted credentials'
      );

      statusItems.value.splice(-1, 1, {
        pending: false,
        message: 'Password store created successfully.',
        icon: 'bi-check-circle-fill text-success',
        variant: 'success',
      });
    } else {
      statusItems.value.splice(-1, 1, {
        pending: false,
        message: 'Password store already exists. No need to create them...',
        icon: 'bi-check-circle-fill text-success',
        variant: 'success',
      });
    }
  } catch (error) {
    statusItems.value.splice(-1, 1, {
      pending: false,
      message: 'Failed to create password store. See console for details.',
      icon: 'bi-x-circle-fill text-danger',
      variant: 'danger',
    });
    console.error('Creation of password store failed:', error);
  }
}



</script>
