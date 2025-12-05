<template>
  <SetupStep title="Finalize Setup">
    <SetupInfoBox
      :visible="true"
    >
      Your setup is nearly finished. Last thing to do now is to set the rights to access and edit the data categories of this extension as follows:<br />
      <br />
      <strong>Normal users</strong> and <strong>Read-access users</strong> (especially third-party systems using the secondary password)
      <ul>
        <li>View ctpassstore: Enable (<i>view</i>).</li>
        <li>settings (category & data): Needs read access. No write access. (<i>view custom category, view custom data</i>)</li>
        <li>encryptionSettings (category & data): No access required.</li>
        <li>passwordStore (category & data): No access required.</li>
        <li>setupCompleted (category & data): Needs read access. No write access. (<i>view custom category, view custom data</i>)</li>
      </ul>
      <br />
      <strong>Administrators of the extension</strong>
      <ul>
        <li>View ctpassstore: Enable (<i>view</i>).</li>
        <li>settings (category & data): Needs read and write access. (<i>view custom category, view custom data, edit custom category, edit custom data</i>)</li>
        <li>encryptionSettings (category & data): No access required.</li>
        <li>passwordStore (category & data): No access required.</li>
        <li>setupCompleted (category & data): Needs read access. (<i>view custom category, view custom data</i>)</li>
      </ul>
      <br />
      <strong>The PHP backend user</strong>
      <ul>
        <li>View ctpassstore: No access required.</li>
        <li>settings (category & data): Needs read access. No write access. (<i>view custom category, view custom data</i>)</li>
        <li>encryptionSettings (category & data): Needs read access. No write access. (<i>view custom category, view custom data</i>)</li>
        <li>passwordStore (category & data): Needs read/write access. (<i>view custom category, view custom data, edit custom category, edit custom data</i>)</li>
        <li>setupCompleted (category & data): No access required.</li>
      </ul>
      <br />
      <br />
      <i>Don't forget to adjust your own rights to one of the user groups above...</i>
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
