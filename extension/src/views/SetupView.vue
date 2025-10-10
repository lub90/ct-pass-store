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
import { Step1 } from '../setup/Step1';
import { DataStructureStep } from '../setup/DataStructureStep'


import { inject } from 'vue';
const churchtoolsClient = inject('churchtoolsClient');

const steps: SetupStep[] = [new DataStructureStep(churchtoolsClient), new Step1()];

const currentStepIndex = ref(0);
const currentStepComponent = computed(() => steps[currentStepIndex.value].component);

const showChecker = ref(true);
const showStep = ref(false);
const showStart = ref(true);
const showNext = ref(false);

const isStartEnabled = ref(false);
const isNextEnabled = ref(false);

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
