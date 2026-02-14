<template>
  <v-layout height="100%">
    <v-navigation-drawer>
      <!-- We need mt-16 here so that the side bar does not disappear behind the top toolbar -->
      <v-list class="mt-16">
        <v-list-item
          title="Secondary Password"
          subtitle="CtPassStore"
        >
        <template #prepend>
          <v-avatar color="dark-blue">
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
          title="Your Secondary Password"
          to="password"
          link
        >
        <template #prepend>
          <v-avatar color="light-blue" size="small" rounded="sm">
            <v-icon color="primary">mdi-lock</v-icon>
          </v-avatar>
        </template>
        </v-list-item>

        <!-- Settings -->
        <v-list-item
          v-if="setupFinished && canEditSettings"
          title="Settings"
          to="settings"
          link
        >
          <template #prepend>
            <v-avatar color="light-blue" size="small" rounded="sm">
              <v-icon color="primary">mdi-cog</v-icon>
            </v-avatar>
          </template>
        </v-list-item>

        <!-- Setup -->
        <v-list-item
          v-if="showSetup"
          prepend-icon="mdi-wrench"
          title="Setup"
          to="setup"
          link
        >
          <template #prepend>
            <v-avatar color="light-blue" size="small" rounded="sm">
              <v-icon color="primary">mdi-wrench</v-icon>
            </v-avatar>
          </template>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main class="h-screen bg-background">
      <slot />
    </v-main>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, inject } from 'vue';
import { Permissions } from '@/ct-utils/lib/Permissions';
import { AppConfig } from '../AppConfig';
import { ExtensionData } from '@/ct-utils/lib/ExtensionData';
import { setupCompleted } from '../setup/SetupStatus';

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
const permissions = new Permissions(churchtoolsClient, AppConfig.EXTENSION_KEY);

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
