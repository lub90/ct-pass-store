<template>

    <BaseLayout>
        <template #title>⚙️ Setup</template>
        <template #subtitle>Setup the CtPassStore extension</template>
        
        <SetupStartPage
        v-if="showSetupStartPage"
        @complete="enableStart"
        />

        <component
            v-if="showStep"
            :is="currentStepComponent"
            @completed="enableNextStep"
        />
        
        <template #footer>
            <!-- Start Setup -->
            <v-btn
                v-if="showSetupStartPage"
                variant="tonal"
                prepend-icon="mdi-play-circle"
                @click="startSetup"
                :disabled="!isStartEnabled"
            >
                Start Setup
            </v-btn>

            <!-- Back -->
            <v-btn
                v-if="showBack"
                variant="tonal"
                prepend-icon="mdi-arrow-left"
                @click="previousStep"
            >
                Back
            </v-btn>

            <!-- Retry -->
            <v-btn
                v-if="showRetry"
                variant="tonal"
                prepend-icon="mdi-refresh"
                @click="retry"
            >
                Retry
            </v-btn>

            <!-- Next -->
            <v-btn
                v-if="showNext"
                variant="tonal"
                prepend-icon="mdi-arrow-right"
                @click="nextStep"
                :disabled="!isNextEnabled"
            >
                Next
            </v-btn>

            <!-- Finish Setup -->
            <v-btn
                v-if="showFinish"
                color="success"
                variant="tonal"
                prepend-icon="mdi-check-circle"
                :disabled="!isNextEnabled"
                @click="finishSetup"
            >
                Finish Setup
            </v-btn>
            </template>

    </BaseLayout>

</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseLayout from '../layouts/BaseLayout.vue';
import SetupStartPage from '../components/SetupStartPage.vue';
import type { SetupStep } from '../types/SetupStep';
import SetupDataStructureStepComponent from '../setup/SetupDataStructureStepComponent.vue'
import SetupBackendInstructionsComponent from '../setup/SetupBackendInstructionsComponent.vue'
import TestBackendComponent from '../setup/TestBackendComponent.vue'
import RightsConfirmationStepComponent from '../setup/RightsConfirmationStepComponent.vue'
import EncryptionSetupStepComponent from '../setup/EncryptionSetupStepComponent.vue'
import SettingsSetupStepComponent from '../setup/SettingsSetupStepComponent.vue'
import FinalUpdateRightsStepComponent from '../setup/FinalUpdateRightsStepComponent.vue';
import { CtSetupStep } from '../setup/CtSetupStep';
import { useRouter } from 'vue-router';

const router = useRouter();

// We do not check if the setup has been run before. Consequently, a setup and each step should be idempotent or at least check whether it should change something

const steps: SetupStep[] = [
    new CtSetupStep(RightsConfirmationStepComponent),
    new CtSetupStep(SetupDataStructureStepComponent),
    new CtSetupStep(EncryptionSetupStepComponent),
    new CtSetupStep(SetupBackendInstructionsComponent),
    new CtSetupStep(SettingsSetupStepComponent),
    new CtSetupStep(TestBackendComponent),
    // This step also marks the setup as completed...
    new CtSetupStep(FinalUpdateRightsStepComponent)
];

const currentStepIndex = ref(-1);
const currentStep = computed(() => {
    return currentStepIndex.value < 0
        ? null
        : steps[currentStepIndex.value]
    });
const currentStepComponent = computed(() => {
    return currentStepIndex.value < 0
        ? null
        : steps[currentStepIndex.value].component
    });
const showStep = computed(() => {
  return currentStepIndex.value >= 0 && currentStepIndex.value < steps.length
})
const showBack = computed(() => {
    if (currentStep.value === null) {
        return false
    }
    return currentStep.value.allowBack()
    });
const showRetry = computed(() => {
    if (currentStep.value === null) {
        return false
    }
    return currentStep.value.allowRetry()
    });
const showNext = computed(() => {
    return currentStepIndex.value >= 0 &&
        currentStepIndex.value + 1 < steps.length
    });
const showFinish = computed(() => {
        return currentStepIndex.value + 1 === steps.length
    });


const showSetupStartPage = computed(() => {
    return currentStepIndex.value < 0;
    });
const isStartEnabled = ref(false);
const isNextEnabled = ref(false);

function enableStart() {
    isStartEnabled.value = true;
}

function startSetup() {
    if (!isStartEnabled.value) return;

    currentStepIndex.value = 0;
    isNextEnabled.value = false;
}

function enableNextStep() {
    isNextEnabled.value = true;
}

function nextStep() {
    if (!isNextEnabled.value) return;
    currentStepIndex.value++;
    isNextEnabled.value = false;
}

function previousStep() {
    currentStepIndex.value--;
    isNextEnabled.value = false;
}

function retry() {
    // TODO: Implement
}

function finishSetup() {
    router.push('./settings');
}

</script>
