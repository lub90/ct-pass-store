
<template>
    <SetupStep title="Setting up the data structure…">

        <!-- Intro text -->
        <v-card-text class="mb-3 font-weight-semibold">
          Generating the necessary data categories...
        </v-card-text>

        <SetupProcess
          :elements="creationSteps"
          successMessage="All data structures were generated. Please continue with the next step."
          failMessage="Unable to generate necessary data structures. Cannot continue with setup!"
          @complete="onComplete"
        />

        <SetupResultBox
            :finished="finished"
            :all-okay="allOkay"
            success-message="✓ All data structures were generated. Please continue with the next step."
            error-message="✗ Unable to generate necessary data structures. Cannot continue with setup!"
        />

    </SetupStep>
</template>

<script setup lang="ts">
import SetupStep from './SetupStep.vue';
import SetupProcess from '../components/SetupProcess.vue';
import SetupResultBox from './SetupResultBox.vue';
import { ref, onMounted } from 'vue';
import { inject } from 'vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig'
import { SetupProcessElementResult } from '../types/SetupProcessElementResult'
import { SetupProcessElement } from '../types/SetupProcessElement'


const churchtoolsClient = inject('churchtoolsClient');
const extensionData: ExtensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

const finished = ref(false);
const allOkay = ref(false);
const creationSteps = [
  setupSettings(extensionData),
  setupInternalSettings(extensionData),
  setupPasswordStore(extensionData),
  setupSetupCompleted(extensionData)
]


const emit = defineEmits<{
    (e: 'completed'): void;
}>();

function setupSettings(extensionData: ExtensionData): SetupProcessElement {
  return setupDataStructure(
    extensionData,
    AppConfig.SETTINGS_CATEGORY,
    AppConfig.SETTINGS_CATEGORY_SHORTY,
    AppConfig.SETTINGS_CATEGORY_SCHEMA,
    "Settings"
  );
}

function setupInternalSettings(extensionData: ExtensionData): SetupProcessElement {
  return setupDataStructure(
    extensionData,
    AppConfig.ENCRYPTION_SETTINGS_CATEGORY,
    AppConfig.ENCRYPTION_SETTINGS_CATEGORY_SHORTY,
    AppConfig.ENCRYPTION_SETTINGS_SCHEMA,
    "Constants"
  );
}

function setupSetupCompleted(extensionData: ExtensionData): SetupProcessElement {
  return setupDataStructure(
    extensionData,
    AppConfig.SETUP_COMPLETED_CATEGORY,
    AppConfig.SETUP_COMPLETED_CATEGORY_SHORTY,
    AppConfig.SETUP_COMPLETED_SCHEMA,
    "Flags"
  );
}

function setupPasswordStore(extensionData: ExtensionData): SetupProcessElement {
  return setupDataStructure(
    extensionData,
    AppConfig.PASSWORD_STORE_CATEGORY,
    AppConfig.PASSWORD_STORE_CATEGORY_SHORTY,
    AppConfig.PASSWORD_STORE_SCHEMA,
    "Password Database"
  );
}


function setupDataStructure(extensionData: ExtensionData, category: string, categoryShorty: string, categorySchema: string, displayName: string): SetupProcessElement {
  return new SetupProcessElement(
    `Creating ${displayName}...`,
    runSetupDataStructure(extensionData, category, categoryShorty, categorySchema, displayName)
  );
}


async function runSetupDataStructure(extensionData: ExtensionData, category: string, categoryShorty: string, categorySchema: string, displayName: string): Promise<SetupProcessElementResult> {
  try {

    const categoryAlreadyExists = await extensionData.hasCategory(category);

    if (categoryAlreadyExists) {
      return {
        successful: true,
        message: `${displayName} already exist. No need to create them...`
      }
    } else {
      await extensionData.createCategory(
        category,
        categoryShorty,
        categorySchema,
        `Stores extension ${displayName}`
      );
      return {
        successful: true,
        message: `${displayName} created successfully.`
      }
    }

  } catch (error) {
    console.error(`Creation of ${displayName} failed:`, error);
    return {
      successful: false,
      message: `Failed to create ${displayName}. See console for details.`
    }
  }
}

function onComplete() {
  emit('completed')
}

</script>
