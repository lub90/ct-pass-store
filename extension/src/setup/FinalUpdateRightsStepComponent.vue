<template>
  <SetupStep title="Finalize Setup">
    <SetupInfoBox
      :visible="true"
    >
      Your setup is nearly finished. Last thing to do now is to set the rights to access and edit the data categories of this extension as follows:<br />
        - <strong>settings</strong> category: Give read access to all users of this extension. Give write access to all administrators of this extension.<br />
        - <strong>encryptionSettings</strong> category: No need to assign anybody any rights, besides the user for the PHP backend.<br />
        - <strong>passwordStore</strong> category: No need to assign anybody any rights, besides the user for the PHP backend.<br />
        - <strong>setupCompleted</strong> category: Give read access to all users of this extension and all administrators of this extension.
    </SetupInfoBox>

    <SetupCheckboxBox
      v-model="confirmed"
      label="I have completed the rights assignment"
    >
      Confirm to continue setup...
    </SetupCheckboxBox>
  </SetupStep>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { inject, watch } from 'vue';

import SetupStep from './SetupStep.vue';
import SetupInfoBox from './SetupInfoBox.vue';
import SetupCheckboxBox from './SetupCheckboxBox.vue';

import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';

const emit = defineEmits<{
  (e: 'completed'): void;
}>();

const confirmed = ref(false);
const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

onMounted(async () => {
  try {
    const hasData = await extensionData.categoryHasData(AppConfig.SETUP_COMPLETED_CATEGORY);
    if (hasData) {
      const existing = await extensionData.getCategoryData(AppConfig.SETUP_COMPLETED_CATEGORY);
      for (const entry of existing) {
        await extensionData.deleteCategoryEntry(AppConfig.SETUP_COMPLETED_CATEGORY, entry.id);
      }
    }

    await extensionData.createCategoryEntry(AppConfig.SETUP_COMPLETED_CATEGORY, {
      setupCompleted: true,
    });
  } catch (error) {
    console.error('Failed to mark setup as completed:', error);
  }
});

// Watch for checkbox change and emit immediately when checked
watch(confirmed, (val) => {
  if (val) emit('completed');
});

</script>
