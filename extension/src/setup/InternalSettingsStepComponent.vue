<template>
  <SetupStep title="Setting up Encryption…">
    <SetupStatusList :items="statusItems" />

    <SetupResultBox
      :finished="finished"
      :all-okay="allOkay"
      success-message="✓ Encryption successfully setup."
      error-message="✗ Unable to setup encryption. Cannot continue with setup!"
    />
  </SetupStep>
</template>

<script setup lang="ts">
import SetupStep from './SetupStep.vue';
import SetupStatusList from './SetupStatusList.vue';
import SetupResultBox from './SetupResultBox.vue';

import { ref, onMounted } from 'vue';
import { inject } from 'vue';
import { defineEmits } from 'vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';

const churchtoolsClient = inject('churchtoolsClient');
const statusItems = ref<StatusItem[]>([]);
const finished = ref(false);
const allOkay = ref(false);

const emit = defineEmits<{
    (e: 'completed'): void;
}>();


onMounted(async () => {
    const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

    // TODO: Check if we have write permissions...

    const hasData = await extensionData.categoryHasData(AppConfig.INTERNAL_SETTINGS_CATEGORY);

    if (!hasData) {
        statusItems.value.push({
            pending: true,
            message: 'Storing encryption data...',
        });

        try {
            await setInternalSettings(extensionData);

            statusItems.value.splice(-1, 1, {
                pending: false,
                message: 'Encryption setup successfully.',
                icon: 'bi-check-circle-fill text-success',
                variant: 'success',
            });
        } catch (error) {
            statusItems.value.splice(-1, 1, {
                pending: false,
                message: 'Failed to setup encryption. See console for details.',
                icon: 'bi-x-circle-fill text-danger',
                variant: 'danger',
            });
            console.error('Creation of internal settings failed:', error);
        }
    } else {
        statusItems.value.push({
            pending: false,
            message: 'Encryption already setup. No need to generate it...',
            icon: 'bi-check-circle-fill text-success',
            variant: 'success',
        });
    }

    // Verify final state
    const updatedExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
    try {
        const entry = await updatedExtensionData.getCategoryData(AppConfig.INTERNAL_SETTINGS_CATEGORY, true);
        if (entry && entry.id) {
            allOkay.value = true;
            emit('completed');
        }
    } catch (error) {
        console.warn('Internal settings verification failed:', error);
    }

    finished.value = true;
});

async function setInternalSettings(extensionData: ExtensionData): Promise<void> {
    const privateKey = await retrievePrivateKey();

    const payload = {
        publicKey: privateKey,
    };

    await extensionData.createCategoryEntry(AppConfig.INTERNAL_SETTINGS_CATEGORY, payload);
}

async function retrievePrivateKey(): Promise<string> {
    // Replace this with your actual key generation or retrieval logic
    return '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh...IDAQAB\n-----END PUBLIC KEY-----';
}
</script>
