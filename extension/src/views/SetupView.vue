<template>

    <BaseLayout>
        <template #title>⚙️ Setup Extension</template>
        
        <PreconditionChecker
        v-if="showChecker"
        :steps="steps"
        @complete="enableStart"
        />

        <component
            v-if="showStep"
            :is="currentStepComponent"
            @completed="enableNextStep"
        />
        
        <template #footer>
            <button
                v-if="showStart"
                class="btn btn-primary rounded-pill px-4"
                @click="startSetup"
                :disabled="!isStartEnabled"
            >
                Start Setup
            </button>
            <button
                v-if="showNext"
                class="btn btn-primary rounded-pill px-4"
                @click="nextStep"
                :disabled="!isNextEnabled"
            >
                Next >
            </button>
        </template>
    </BaseLayout>

</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseLayout from '../layouts/BaseLayout.vue';
import PreconditionChecker from '../components/PreconditionChecker.vue';
import type { SetupStep } from '../types/SetupStep';
import { SetupDataStructureStep } from '../setup/SetupDataStructureStep'
import {RightsConfirmationStep} from '../setup/RightsConfirmationStep'
import { EncryptionSetupStep } from '../setup/EncryptionSetupStep'
import { SettingsSetupStep } from '../setup/SettingsSetupStep'
import { ExtensionData } from '../api/ExtensionData';
import { FinalUpdateRightsStep } from '../setup/FinalUpdateRightsStep';


import { inject } from 'vue';
const churchtoolsClient = inject('churchtoolsClient');

const steps: SetupStep[] = [
    new RightsConfirmationStep(churchtoolsClient),
    new SetupDataStructureStep(churchtoolsClient),
    new EncryptionSetupStep(churchtoolsClient),
    // TODO: One step is missing here: Setup instructions for the Backend
    new SettingsSetupStep(churchtoolsClient),
    // TODO: One step is missing here: Test of the backen
    new FinalUpdateRightsStep(churchtoolsClient)
];

const currentStepIndex = ref(0);
const currentStepComponent = computed(() => steps[currentStepIndex.value].component);

const showChecker = ref(true);
const showStep = ref(false);
const showStart = ref(true);
const showNext = ref(false);

const isStartEnabled = ref(false);
const isNextEnabled = ref(false);

// We do not check if the setup has been run before. A setup and each step should be idempotent

function enableStart() {
    isStartEnabled.value = true;
    showStart.value = true;
}

function startSetup() {
    if (!isStartEnabled.value) return;
    showChecker.value = false;
    showStep.value = true;

    showStart.value = false;
    showNext.value = true;
    isNextEnabled.value = false;
}

function enableNextStep() {
    isNextEnabled.value = true;
    showNext.value = true;
}

function nextStep() {
    if (!isNextEnabled.value) return;
    currentStepIndex.value++;
    isNextEnabled.value = false;
}

</script>
