<template>
  <v-layout height="100%">
    <v-navigation-drawer permanent>
      <!-- We need mt-16 here so that the side bar does not disappear behind the top toolbar -->
      <v-list class="mt-16">
        <v-list-item
          title="Secondary Password"
          subtitle="CtPassStore"
        >
        <template #prepend>
          <v-avatar color="primary">
            <v-icon icon="mdi-lock" color="white"></v-icon>
          </v-avatar>
        </template>
      </v-list-item>
      </v-list>

      <v-divider></v-divider>

      <v-list density="compact" nav>
        <!-- Password entry -->
        <v-list-item
          v-if="setupFinished"
          prepend-icon="mdi-lock"
          title="Your Secondary Password"
          to="password"
          link
        ></v-list-item>

        <!-- Settings -->
        <v-list-item
          v-if="setupFinished && canEditSettings"
          prepend-icon="mdi-cog"
          title="Settings"
          to="settings"
          link
        ></v-list-item>

        <!-- Setup -->
        <v-list-item
          v-if="showSetup"
          prepend-icon="mdi-wrench"
          title="Setup"
          to="setup"
          link
        ></v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main class="h-screen">
      <slot />
    </v-main>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, inject } from 'vue';
import { Permissions } from '../api/Permissions';
import { AppConfig } from '../AppConfig';
import { ExtensionData } from '../api/ExtensionData';
import { setupCompleted } from '../setup/SetupStatus';

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
const permissions = new Permissions(churchtoolsClient);

const canEditSettings = ref(false);
const setupFinished = ref(false);
const showSetup = ref(false);

onMounted(async () => {
  try {
    // Firstly, check if the setup is completed
    setupFinished.value = await setupCompleted(extensionData);

    // Then check if we can create categories
    const canCreateCategories: boolean = await permissions.canCreateCustomCategory();
    showSetup.value = canCreateCategories && !setupFinished.value;

    // If setup is completed, check if we want to show the settings
    if (setupFinished.value) {
      const category: any = await extensionData.getCategoryByName(AppConfig.SETTINGS_CATEGORY);
      canEditSettings.value = await permissions.canEditCustomDataForCategory(category.id);
    }
  } catch (err) {
    console.error('Permission check failed:', err);
  }
});
</script>
