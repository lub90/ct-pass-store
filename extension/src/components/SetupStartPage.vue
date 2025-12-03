<template>
  <v-sheet>
    <!-- Intro text -->
    <v-card-text class="mb-3 font-weight-semibold">
      The extension has not been set up yet. Checking preconditions to start setup...
    </v-card-text>

    <!-- Reusable SetupProcess component -->
    <SetupProcess
      :steps="checks"
      successMessage="All preconditions fulfilled. You can start the setup."
      failMessage="Some preconditions are not fulfilled. Setup cannot be started."
      @complete="onComplete"
    />
  </v-sheet>
</template>

<script setup lang="ts">
import SetupProcess from './SetupProcess.vue'
import { SetupProcessStatus } from '../types/SetupProcessStatus'
import type { SetupStep } from '../setup/SetupStep.vue'
import { inject, ref, onMounted } from 'vue';
import { Permissions } from '../api/Permissions';

const churchtoolsClient = inject('churchtoolsClient');
const permissions = new Permissions(churchtoolsClient);

// Final signal if everything is okay
const emit = defineEmits<{
  (e: 'complete'): void;
}>();

// Currently, we do not use the setup steps - but might be interesting to display a setup agenda on the start page
// Thus, we leave it in here
const props = defineProps<{
  steps: SetupStep[];
}>()


const checks = [
  checkRightsManagement(),
  checkCanGenerateCategories()
]


async function checkRightsManagement(): Promise<SetupProcessStatus> {
    try {
        // Check rights management (administer person)
        const rights = await permissions.canAdministerPersons();
        return {
            fulfilled: rights,
            description: rights ? 'Access to rights management system confirmed.' : 'Setup requires access to the rights management system, but you are not authorized.',
        };
    } catch (error) {
        console.error('Rights management check failed:', error);
        return {
            fulfilled: false,
            description: "Error occured while checking the rights management permissions: " + error,
        };
    }
}


async function checkCanGenerateCategories(): Promise<SetupProcessStatus> {
    try {
        // Check can generate new cateogries
        const newCategories = await permissions.canCreateCustomCategory()
        return {
                fulfilled: newCategories,
                description: newCategories ? 'Permission to generate new categories confirmed.' : 'Setup requires permission to generate new categories, but you are not authorized.',
            };
    } catch (error) {
        console.error('Permission to generate new categories failed:', error);
        return {
            fulfilled: false,
            description: "Error occured while checking the permission to generate categories: " + error,
        };
    }
}


// Handle completion signal
function onComplete() {
  emit('complete');
}

</script>