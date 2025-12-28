<template>
  <SetupStep title="Configure Extension Settings">

    <!-- Intro text -->
    <v-card-text class="mb-3 font-weight-semibold">
      Configure your extension's settings and click "Save Settings"!
    </v-card-text>

    <SettingsForm @saved="emit('completed')" />
  </SetupStep>
</template>

<script setup lang="ts">
import { inject } from 'vue';
import SetupStep from './SetupStep.vue';
import SettingsForm from '../components/settingsPage/SettingsForm.vue';
import { ExtensionData } from '@/ct-utils/lib/ExtensionData';
import { AppConfig } from '../AppConfig';

const emit = defineEmits<{
  (e: 'completed'): void;
}>();

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
</script>
