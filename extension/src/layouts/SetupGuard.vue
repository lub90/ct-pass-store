<template>
    <div class="container py-4">
        <!-- Loading spinner while check is running -->
        <div v-if="!checkCompleted" class="d-flex align-items-center gap-2">
            <div class="spinner-border text-primary" role="status" />
            <span>Starting extension...</span>
        </div>

        <!-- Error: No access rights -->
        <div v-else-if="!correctAccessRights" class="alert alert-danger d-flex align-items-center gap-2">
            <i class="bi bi-x-circle-fill text-danger"></i>
            <span>You do not have sufficient access rights to use this extension.</span>
        </div>

        <!-- Setup completed: show content -->
        <slot v-else-if="setupCompleted" />

        <!-- Setup incomplete: show info message -->
        <div v-else class="alert alert-info d-flex align-items-center justify-content-between">
            <div class="d-flex align-items-center gap-2">
                <i class="bi bi-info-circle-fill text-info"></i>
                <span>Extension is not setup correctly. Run setup.</span>
            </div>
            <router-link :to="`${AppConfig.getExtensionUrlPrefix()}/setup`" class="btn btn-outline-info btn-sm">
                Run setup
            </router-link>
        </div>
    </div>
</template>


<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { inject } from 'vue';
import { AppConfig } from '../AppConfig'
import { ExtensionData } from '../api/ExtensionData';
import { Permissions } from '../api/Permissions';

const churchtoolsClient = inject('churchtoolsClient');

const checkCompleted = ref(false);
const setupCompleted = ref(false);
const correctAccessRights = ref(false);

onMounted(async () => {
    await setupAlreadyCompleted();
    checkCompleted.value = true;
});


async function setupAlreadyCompleted(): Promise<void> {
    const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
    const permissions = new Permissions(churchtoolsClient);

    // Step 1: Check if user has permission to view custom data
    // TODO: This is just a rough check. Because read access might also be enabled for another category. Sadly we cannot determine whether we have the read access to the right categories. As such, this must be sufficient.
    const canView = await permissions.canViewCustomData();
    if (!canView) {
        console.warn('User lacks permission to view custom data.');
        correctAccessRights.value = false;
        return;
    }

    // Acces right check seems to be complete
    correctAccessRights.value = true;

    // Step 2: Check if any categories exist
    const hasCategories = await extensionData.hasCategory(AppConfig.SETUP_COMPLETED_CATEGORY);
    if (!hasCategories) {
        console.info('Settings category not found — setup has not started.');
        setupCompleted.value = false;
        return;
    }

    // Step 3: Check if categories contain settings data
    const setupHasData = await extensionData.categoryHasData(AppConfig.SETUP_COMPLETED_CATEGORY);
    if (!setupHasData) {
        console.info('Settings category exists but contains no data — setup incomplete.');
        setupCompleted.value = false;
        return;
    }

    // Step 4: Check if setup_completed flag is set
    const setupEntry = await extensionData.getCategoryData(AppConfig.SETUP_COMPLETED_CATEGORY, true);

    try {
        const parsed = JSON.parse(setupEntry.value);
        if (parsed.setupCompleted === true) {
            setupCompleted.value = true;
            return;
        } else {
            console.info('Setup flag is present but not completed.');
            setupCompleted.value = false;
            return;
        }
    } catch (error) {
        console.error('Failed to parse setup entry value:', error);
        return;
    }
}

</script>
