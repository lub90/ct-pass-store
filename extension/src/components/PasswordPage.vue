<template>
    <BaseLayout>
      <template #title>🔑 Secondary Password</template>
      <template #subtitle>Manage your secondary password here</template>

      <!-- While loading the settings-->
      <v-alert
        v-if="loading"
        type="info"
        density="compact"
        class="mx-auto my-4"
        max-width="1200"
        >
        <template #prepend>
            <v-progress-circular indeterminate color="primary" size="20" />
        </template>
        Loading settings...
      </v-alert>

      <!-- Case: only reset allowed -->
      <v-sheet v-if="!loading && !settings.allowCustomPassword">
        <v-alert
          v-if="!loading && !settings.allowCustomPassword"
          type="info"
          density="compact"
          class="mx-auto my-4"
          >
          Your administrator has set up secondary passwords so that you cannot create one yourself. Click below to generate a random password. Once you do, the new password will be displayed to you.
        </v-alert>
      </v-sheet>

      <!-- While saving the password -->
      <v-alert
        v-if="saving"
        type="info"
        density="compact"
        class="mx-auto my-4"
        >
        <template #prepend>
            <v-progress-circular indeterminate color="primary" size="20" />
        </template>
        Setting new password - please wait...
      </v-alert>

      <!-- Feedback messages -->
      <v-alert
        v-if="successMessage"
        type="success"
        density="compact"
      >
        <div v-html="successMessage"></div>
      </v-alert>
      <v-alert
        v-if="errorMessage"
        type="error"
        density="compact">
        <div v-html="errorMessage"></div>
      </v-alert>





      <!-- Case: allow custom password -->
      <v-sheet v-if="!loading && settings.allowCustomPassword" class="mt-6">
        <v-input>
          <template #prepend>
            <p class="text-body-1 font-weight-medium" style="width:170px;">Secondary Password:</p>
          </template>
          <v-text-field
              v-model="newPassword"
              type="password"
              label="New secondary password"
              placeholder="New secondry password"
              variant="outlined"
              density="comfortable"
              style="max-width: 400px;"
            />
        </v-input>

        <v-input>
          <template #prepend>
            <p class="text-body-1 font-weight-medium" style="width:170px;">Repeat Password:</p>
          </template>
          <v-text-field
            v-model="repeatPassword"
            type="password"
            label="Repeat new secondary password"
            placeholder="Repeat new secondary password"
            variant="outlined"
            density="comfortable"
            style="max-width: 400px;"
          />
        </v-input>

        <!-- Criteria feedback -->
        <v-list density="compact">
          <v-list-subheader class="text-body-1 font-weight-medium">
            Secondary Password Criteria
          </v-list-subheader>
          <v-list-item>
            <template #prepend>
              <v-icon :class="criteriaMet.length ? 'text-success' : 'text-error'">
                {{ criteriaMet.length ? 'mdi-check-circle' : 'mdi-close-circle' }}
              </v-icon>
            </template>
            Minimum length: {{ settings.passwordLength }} characters
          </v-list-item>

          <v-list-item>
            <template #prepend>
              <v-icon :class="criteriaMet.special ? 'text-success' : 'text-error'">
                {{ criteriaMet.special ? 'mdi-check-circle' : 'mdi-close-circle' }}
              </v-icon>
            </template>
            Contains at least one special character (!@$%&*-_+=?.)
          </v-list-item>

          <v-list-item>
            <template #prepend>
              <v-icon :class="criteriaMet.hasDigit ? 'text-success' : 'text-error'">
                {{ criteriaMet.hasDigit ? 'mdi-check-circle' : 'mdi-close-circle' }}
              </v-icon>
            </template>
            Contains at least one digit (0-9)
          </v-list-item>

          <v-list-item>
            <template #prepend>
              <v-icon :class="criteriaMet.hasLetter ? 'text-success' : 'text-error'">
                {{ criteriaMet.hasLetter ? 'mdi-check-circle' : 'mdi-close-circle' }}
              </v-icon>
            </template>
            Contains at least one letter
          </v-list-item>

          <v-list-item>
            <template #prepend>
              <v-icon :class="criteriaMet.onlyValidChars ? 'text-success' : 'text-error'">
                {{ criteriaMet.onlyValidChars ? 'mdi-check-circle' : 'mdi-close-circle' }}
              </v-icon>
            </template>
            Contains only valid chars (letters, digits and special characters)
          </v-list-item>

          <v-list-item>
            <template #prepend>
              <v-icon :class="criteriaMet.match ? 'text-success' : 'text-error'">
                {{ criteriaMet.match ? 'mdi-check-circle' : 'mdi-close-circle' }}
              </v-icon>
            </template>
            Passwords match
          </v-list-item>
        </v-list>
      </v-sheet>





      <!-- Primary password field if required -->
      <v-sheet
        v-if="!loading && settings.requirePasswordForPasswordChange"
        color="transparent"
        class="d-flex flex-column mt-10"
      >
        <div class="text-body-2 text-muted mb-2">
          You are required to enter your primary ChurchTools password in order to reset your secondary password.
        </div>

        <v-input>
          <template #prepend>
            <p class="text-body-1 font-weight-medium" style="width:170px;">Primary Password:</p>
          </template>
          <v-text-field
            v-model="primaryPassword"
            type="password"
            label="Your primary ChurchTools password"
            placeholder="Your primary ChurchTools password"
            variant="outlined"
            density="comfortable"
            style="max-width: 400px;"
          />
        </v-input>
      </v-sheet> 



      <!-- Save/Reset button -->
      <v-btn
          v-if="!loading"
        variant="tonal"
        class="mt-4"
        :disabled="(settings.requirePasswordForPasswordChange && !primaryPassword) || (settings.allowCustomPassword && !allCriteriaMet)"
        @click="saveResetPassword"
      >
        {{ settings.allowCustomPassword ? 'Save secondary password' : 'Reset secondary password' }}
      </v-btn>

    </BaseLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue';
import BaseLayout from '../layouts/BaseLayout.vue';
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from '../AppConfig';

const churchtoolsClient = inject('churchtoolsClient');
const extensionData = new ExtensionData(churchtoolsClient, AppConfig.EXTENSION_KEY);

const loading = ref(true);
const settings = ref<any>({
  allowCustomPassword: false,
  requirePasswordForPasswordChange: false,
  passwordLength: 12,
});
const saving = ref(false);

const primaryPassword = ref('');
const newPassword = ref('');
const repeatPassword = ref('');
const backendUrl = ref('');
const successMessage = ref('');
const errorMessage = ref('');

// Criteria checks
// TODO: Move special characters in string of AppConfig
const criteriaMet = computed(() => {
  return {
    length: newPassword.value.length >= settings.value.passwordLength,
    special: /[!@$%&*\-_\+=?.]/.test(newPassword.value),
    hasDigit: /\d/.test(newPassword.value),
    hasLetter: /[A-Za-z]/.test(newPassword.value),
    onlyValidChars: /^[A-Za-z0-9!@$%&*\-_\+=?.]+$/.test(newPassword.value),
    match: newPassword.value && newPassword.value === repeatPassword.value,
  };
});

const allCriteriaMet = computed(() => {
  return Object.values(criteriaMet.value).every(Boolean)
});

onMounted(async () => {
  try {
    const entry = await extensionData.getCategoryData(AppConfig.SETTINGS_CATEGORY, true);
    const values = JSON.parse(entry.value);
    settings.value = values;
    backendUrl.value = values.backendUrl;
  } catch (err) {
    console.error('Failed to load settings:', err);
  } finally {
    loading.value = false;
  }
});


async function saveResetPassword() {
  saving.value = true;

  const body: any = {};
  if (settings.value.requirePasswordForPasswordChange) {
    body.primaryPwd = primaryPassword.value;
  }

  if (settings.value.allowCustomPassword) {
    body.secondaryPwd = newPassword.value; // or generated one for reset
  }

  const userId = (await churchtoolsClient.get('/whoami'))['id'];
  const loginToken = await churchtoolsClient.get(`/persons/${userId}/logintoken`);

  const response = await updatePassword(
    userId,
    body,
    backendUrl.value,
    loginToken
  );

  if (response.status == 200) {
    const data = await response.json();
    successMessage.value = `Your new secondary password is: <br\><b> ${data.secondaryPwd} </b><br \>Please remember it or store it securely. You will only see it here once.`;
  } else if (response.status == 204) {
    successMessage.value = 'Password has been saved successfully.';
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

async function updatePassword(userId: number, body: any, backendUrl: string, token: string) {
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
