<template>
    <BaseLayout>
      <template #title>🔑 Secondary Password</template>
      <template #subtitle>Manage your secondary password here</template>

      <!-- Guard page while loading everything -->
      <LoadingGuard :state="loadState" :error="loadError">

        <!-- Feedback and settings messages -->
        <AlertMessages
          :state="alertState"
          :success="successMessage"
          :error="errorMessage"
          loading-text="Setting new password - please wait..."
        />

        <v-form @submit.prevent="saveResetPassword" ref="form">

          <!-- Case: only reset allowed -->
          <v-sheet v-if="!settings.allowCustomPassword">
            <v-alert
              type="info"
              density="compact"
              class="mx-auto my-4"
              >
              Your administrator has set up secondary passwords so that you cannot create one yourself. Click below to generate a random password. Once you do, the new password will be displayed to you.
            </v-alert>
          </v-sheet>

          <!-- Case: admins can select for whom they want to reset the password -->
            
          <PersonSelectInput
            v-if="isAdmin"
            v-model="selectedPersonId"
            :users="persons"
          />


          <!-- Case: allow custom password -->
          <CustomPasswordInput
            v-if="settings.allowCustomPassword"
            v-model="newPassword"
            :password-length="settings.passwordLength"
          />

          <!-- Primary password field if required -->
          <PrimaryPasswordInput
            v-if="settings.requirePasswordForPasswordChange"
            v-model="primaryPassword"
          />

          <!-- Save/Reset button -->
          <v-btn
            type="submit"
            color="primary"
            :disabled="!canSubmit || saving"
          >
            <v-icon start>mdi-content-save</v-icon>
            {{ settings.allowCustomPassword ? 'Save secondary password' : 'Reset secondary password' }}
          </v-btn>

        </v-form>

      </LoadingGuard>

    </BaseLayout>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue';
import BaseLayout from '../layouts/BaseLayout.vue';
import { ExtensionData } from '@/ct-utils/lib/ExtensionData';
import { AppConfig } from '../AppConfig';
import PersonSelectInput from './passwordPage/PersonSelectInput.vue';
import type { Person } from '../utils/ct-types.d.ts';
import { loadWithState } from "@/ct-extension-utils/composables/loadWithState.ts";
import LoadingGuard from '@/ct-extension-utils/components/LoadingGuard.vue';
import PrimaryPasswordInput from './passwordPage/PrimaryPasswordInput.vue'
import CustomPasswordInput from './passwordPage/CustomPasswordInput.vue'
import { AlertState } from '@/ct-extension-utils/types/AlertState'
import AlertMessages from '@/ct-extension-utils/components/AlertMessages.vue'

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);
// Basic variables
const settings = ref<any>({
  allowCustomPassword: false,
  requirePasswordForPasswordChange: false,
  passwordLength: 12,
  adminUsers: []
});
const ownUserId = ref<number>(-1);
const isAdmin = computed(() => {
  return settings.value.adminUsers?.includes(ownUserId.value) ?? false;
});

// Password related variables
const primaryPassword = ref('');
const newPassword = ref('');

// Person selection related variables
const selectedPersonId = ref<number>(-1);
const persons = ref<Person[]>([]);

// Form related variables
const form = ref();
const formValid = ref(false);
const saving = ref(false);
const successMessage = ref('');
const errorMessage = ref('');
const alertState = computed(() => {
  if (saving.value) return AlertState.Loading;
  if (errorMessage.value) return AlertState.Error;
  if (successMessage.value) return AlertState.Success;
  return AlertState.Idle;
});

// Check if form is valid
watch(
  () => form.value?.isValid,
  (val) => {
    formValid.value = val ?? false;
  }
);

// Helper to express business logic that form is allowed to submit if no input is required
const canSubmit = computed(() => {
  // Case: only reset allowed → always valid
  if (!settings.value.allowCustomPassword &&
      !settings.value.requirePasswordForPasswordChange) {
    return true;
  }

  // Otherwise rely on Vuetify validation
  return formValid.value;
});

// Helper to suppress message clear as soon as somebody types something new...
const suppressMessageClear = ref(false);

// Let success message disappear as soon as somebody types something new
watch([newPassword, primaryPassword], () => {
  if (suppressMessageClear.value) return;   // ignore programmatic changes
  successMessage.value = '';
  errorMessage.value = '';
});




// Use the load guard to load -> Replaces onMounted
const {
  state: loadState,
  error: loadError
} = loadWithState<void>(async () => {
  ownUserId.value = (await churchtoolsClient.get('/whoami'))['id'];
  selectedPersonId.value = ownUserId.value;

  await loadSettings();

  if (isAdmin.value) {
    await loadAllUsers();
  }
});


async function loadSettings() {
  const entry = await extensionData.getCategoryData(AppConfig.SETTINGS_CATEGORY, true);
  const values = JSON.parse(entry.value);
  settings.value = values;
}



async function loadAllUsers() {
    const loadedPersons: Person[] = await churchtoolsClient.getAllPages("/persons");
    persons.value = loadedPersons;
}


async function saveResetPassword() {
  saving.value = true;

  const body: any = {};
  if (settings.value.requirePasswordForPasswordChange) {
    body.primaryPwd = primaryPassword.value;
  }

  if (settings.value.allowCustomPassword) {
    body.secondaryPwd = newPassword.value; // or generated one for reset
  }

  const loginToken = await churchtoolsClient.get(`/persons/${ownUserId.value}/logintoken`);

  const response = await updatePassword(
    selectedPersonId.value,
    body,
    loginToken
  );

  if (response.status == 200) {
    const data = await response.json();
    successMessage.value = `Your new secondary password is: <br\><b> ${data.secondaryPwd} </b><br \>Please remember it or store it securely. You will only see it here once.`;
    resetForm();
  } else if (response.status == 204) {
    successMessage.value = 'Password has been saved successfully.';
    resetForm();
  } else {
    const data = await response.json().catch(() => null);
    if (data && data.error && data.message) {
      errorMessage.value = `<b>Cannot set secondary password: ${data.error}</b><br /> ${data.message}`;
    } else {
      errorMessage.value = `Request failed with status ${response.status}`;
    }
  }
  saving.value = false;
}


function resetForm() {
  suppressMessageClear.value = true;

  // 1. Reset the actual values
  newPassword.value = '';
  primaryPassword.value = '';
  selectedPersonId.value = ownUserId.value;

  // 2. Reset validation state
  form.value?.reset();            // resets values + validation
  form.value?.resetValidation();  // ensures no red borders

  // 3. Allow watchers again on next tick
  queueMicrotask(() => {
    suppressMessageClear.value = false;
    // Set the selected person id delayed to not interfere with the form reset
    selectedPersonId.value = ownUserId.value;
  });
}

async function updatePassword(userId: number, body: any, token: string) {

  let backendUrl = settings.value.backendUrl;

  if (backendUrl.endsWith('/')) {
    backendUrl = backendUrl.slice(0, -1);
  }

  const response = await fetch(`${backendUrl}/entries/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Login ${token}`
    },
    body: JSON.stringify(body)
  });

  return response;
}

</script>
