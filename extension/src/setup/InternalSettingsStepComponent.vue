<template>
    <div>
        <p>Initializing internal settings…</p>

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

        <div
            v-if="finished"
            :class="['alert', allOkay ? 'alert-success' : 'alert-danger']"
            class="d-flex align-items-center gap-2 py-2 px-3 mb-3 fw-semibold"
        >
            <span v-if="allOkay">✓ Internal settings were successfully initialized.</span>
            <span v-else>✗ Internal settings could not be initialized. Cannot continue with setup!</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { inject } from 'vue';
import { defineEmits } from 'vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';

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
    const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

    const hasData = await extensionData.categoryHasData(AppConfig.INTERNAL_SETTINGS_CATEGORY);

    console.log("TEst");
    console.log(hasData);

    if (!hasData) {
        statusItems.value.push({
            pending: true,
            message: 'Creating internal settings...',
        });

        try {
            await setInternalSettings(extensionData);

            statusItems.value.splice(-1, 1, {
                pending: false,
                message: 'Internal settings created successfully.',
                icon: 'bi-check-circle-fill text-success',
                variant: 'success',
            });
        } catch (error) {
            statusItems.value.splice(-1, 1, {
                pending: false,
                message: 'Failed to create internal settings. See console for details.',
                icon: 'bi-x-circle-fill text-danger',
                variant: 'danger',
            });
            console.error('Creation of internal settings failed:', error);
        }
    } else {
        statusItems.value.push({
            pending: false,
            message: 'Internal settings already exist. No need to create them...',
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
        setupCompleted: true,
        publicKey: privateKey,
    };

    await extensionData.createCategoryEntry(AppConfig.INTERNAL_SETTINGS_CATEGORY, payload);
}

async function retrievePrivateKey(): Promise<string> {
    // Replace this with your actual key generation or retrieval logic
    return '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh...IDAQAB\n-----END PUBLIC KEY-----';
}
</script>
