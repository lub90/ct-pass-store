<template>
  <SetupStep title="Finalize Setup">
    <SetupInfoBox
      :visible="true"
      :content="`
        Your setup is nearly finished. Last thing to do now is to set the rights to access and edit the data categories of this extension as follows:<br />
        - <strong>settings</strong> category: Give read access to all users of this extension. Give write access to all admins.<br />
        - <strong>encryptionSettings</strong> category: No need to assign anybody any rights, besides the user for the external backend.<br />
        - <strong>passwordStore</strong> category: No need to assign anybody any rights, besides the user for the external backend and users of other applications accessing the secondary password.<br />
        - <strong>setupCompleted</strong> category: Give read access to all users of this extension and all admins.
      `"
    />

    <SetupCheckboxBox
      v-model="confirmed"
      :content="''"
      label="I have completed the rights assignment"
    />

    <button
      v-if="confirmed"
      class="btn btn-success mt-3"
      @click="navigateToSettings"
    >
      Finish setup
    </button>
  </SetupStep>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { inject } from 'vue';

import SetupStep from './SetupStep.vue';
import SetupInfoBox from './SetupInfoBox.vue';
import SetupCheckboxBox from './SetupCheckboxBox.vue';

import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';

const emit = defineEmits<{
  (e: 'completed'): void;
}>();

const confirmed = ref(false);
const router = useRouter();
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

function navigateToSettings() {
  emit('completed');
}
</script>
