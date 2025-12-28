<template>
  <v-sheet>
    <!-- Intro text -->
    <v-card-text class="mb-3 font-weight-semibold">
      This is the setup process for the extension. Checking preconditions to start setup...
    </v-card-text>

    <!-- Check Process -->
    <SetupProcess
      :elements="checks"
      successMessage="All preconditions fulfilled. You can start the setup."
      failMessage="Some preconditions are not fulfilled. Setup cannot be started."
      @complete="onComplete"
    />
  </v-sheet>
</template>

<script setup lang="ts">
import SetupProcess from './SetupProcess.vue'
import { SetupProcessElement } from '../types/SetupProcessElement'
import { SetupProcessElementResult } from '../types/SetupProcessElementResult'
import { inject, ref, onMounted } from 'vue';
import { Permissions } from '@/ct-utils/lib/Permissions';

const churchtoolsClient = inject('churchtoolsClient');
const permissions = new Permissions(churchtoolsClient, AppConfig.EXTENSION_KEY);

// Final signal if everything is okay
const emit = defineEmits<{
  (e: 'complete'): void;
}>();

const checks = [
  new SetupProcessElement("Checking rights management permissions...", checkRightsManagement()),
  new SetupProcessElement("Checking permissions to generate data categories...", checkCanGenerateCategories())
]


async function checkRightsManagement(): Promise<SetupProcessElementResult> {
    try {
        // Check rights management (administer person)
        const rights = await permissions.canAdministerPersons();
        return {
            successful: rights,
            message: rights ? 'Access to rights management system confirmed.' : 'Setup requires access to the rights management system, but you are not authorized.',
        };
    } catch (error) {
        console.error('Rights management check failed:', error);
        return {
            successful: false,
            message: "Error occured while checking the rights management permissions: " + error,
        };
    }
}


async function checkCanGenerateCategories(): Promise<SetupProcessElementResult> {
    try {
        // Check can generate new cateogries
        const newCategories = await permissions.canCreateCustomCategory()
        return {
                successful: newCategories,
                message: newCategories ? 'Permission to generate new categories confirmed.' : 'Setup requires permission to generate new categories, but you are not authorized.',
            };
    } catch (error) {
        console.error('Permission to generate new categories failed:', error);
        return {
            successful: false,
            message: "Error occured while checking the permission to generate categories: " + error,
        };
    }
}


// Handle completion signal
function onComplete() {
  emit('complete');
}

</script>