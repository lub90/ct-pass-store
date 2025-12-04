<template>
  <SetupStep title="Configure Extension Settings">

    <!-- Intro text -->
    <v-card-text class="mb-3 font-weight-semibold">
      Choose your settings and click "Save Settings"!
    </v-card-text>

    <SettingsForm
      :extension-data="extensionData"
      :category-name="AppConfig.SETTINGS_CATEGORY"
      @saved="emit('completed')"
    />
  </SetupStep>
</template>

<script setup lang="ts">
import { inject } from 'vue';
import SetupStep from './SetupStep.vue';
import SettingsForm from '../components/SettingsForm.vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';

const emit = defineEmits<{
  (e: 'completed'): void;
}>();

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
</script>
