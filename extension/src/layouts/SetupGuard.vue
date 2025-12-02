<template>
    <div class="container py-4">
        <!-- Loading spinner while check is running -->
        <div v-if="!checkCompleted">
            <v-progress-circular indeterminate color="primary" size="24" />
            <span>Starting extension...</span>
        </div>

        <!-- Error: No access rights -->
         <v-alert
            v-else-if="!correctAccessRights"
            type="error"
            density="compact"
            >
            <v-icon color="error" start>mdi-close-circle</v-icon>
            You do not have sufficient access rights to use this extension.
        </v-alert>

        <!-- Setup completed: show content -->
        <slot v-else-if="setupFinished" />

        <!-- Setup incomplete: show info message -->
        <v-alert
            v-else
            type="info"
            density="compact"
            >
            <v-icon color="info" start>mdi-information</v-icon>
            Extension is not setup correctly.
            <template #append>
                <v-btn
                    :to="`${AppConfig.getExtensionUrlPrefix()}/setup`"
                    variant="outlined"
                    size="small"
                >
                    Run setup
                </v-btn>
            </template>
        </v-alert>
    </div>
</template>


<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { inject } from 'vue';
import { AppConfig } from '../AppConfig'
import { ExtensionData } from '../api/ExtensionData';
import { Permissions } from '../api/Permissions';
import { setupCompleted } from '../setup/SetupStatus';

const churchtoolsClient = inject('churchtoolsClient');

const checkCompleted = ref(false);
const setupFinished = ref(false);
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

    setupFinished.value = await setupCompleted(extensionData);
}

</script>
