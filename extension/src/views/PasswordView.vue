<template>
  <SetupGuard>
    <BaseLayout>
      <template #title>🔑 Change Secondary Password</template>

      <div v-if="loading" class="text-muted">Loading settings…</div>

      <div v-else>
        <!-- Case: allow custom password -->
        <div v-if="settings.allowCustomPassword">
          <p>You can update your secondary password here.</p>

          <!-- Primary password field if required -->
          <div v-if="settings.requirePasswordForPasswordChange" class="mb-3">
            <label class="form-label">Your primary ChurchTools password</label>
            <input
              type="password"
              class="form-control"
              v-model="primaryPassword"
              placeholder="Enter your primary password"
            />
            <br />
          </div>

          

          <!-- New password fields -->
          <div class="mb-3">
            <label class="form-label">New secondary password</label>
            <input
              type="password"
              class="form-control"
              v-model="newPassword"
              placeholder="Enter new password"
            />
          </div>

          <div class="mb-3">
            <label class="form-label">Repeat new secondary password</label>
            <input
              type="password"
              class="form-control"
              v-model="repeatPassword"
              placeholder="Repeat new password"
            />
          </div>

          <!-- Criteria feedback -->
          <ul class="list-unstyled">
            <li :class="criteriaMet.length ? 'text-success' : 'text-danger'">
              Minimum length: {{ settings.passwordLength }} characters
            </li>
            <li :class="criteriaMet.special ? 'text-success' : 'text-danger'">
              Contains at least one special character (!@$%&*-_+=?.)
            </li>
            <li :class="criteriaMet.hasDigit ? 'text-success' : 'text-danger'">
              Contains at least one digit (0-9)
            </li>
            <li :class="criteriaMet.hasLetter ? 'text-success' : 'text-danger'">
              Contains at least one letter
            </li>
            <li :class="criteriaMet.onlyValidChars ? 'text-success' : 'text-danger'">
              Contains only valid chars (letters, digits and special characters)
            </li>
            <li :class="criteriaMet.match ? 'text-success' : 'text-danger'">
              Passwords match
            </li>
          </ul>

          <button
            class="btn btn-primary mt-3"
            :disabled="!canSubmit"
            @click="saveResetPassword"
          >
            Save your secondary Password
          </button>
        </div>

        <!-- Case: only reset allowed -->
        <div v-else>
          <p>You can reset your secondary password here.</p>

          <!-- Primary password field if required -->
          <div v-if="settings.requirePasswordForPasswordChange" class="mb-3">
            <label class="form-label">Your primary ChurchTools password</label>
            <input
              type="password"
              class="form-control"
              v-model="primaryPassword"
              placeholder="Enter your primary password"
            />
          </div>

          <button
            class="btn btn-warning mt-3"
            :disabled="settings.requirePasswordForPasswordChange && !primaryPassword"
            @click="saveResetPassword"
          >
            Reset your secondary password
          </button>
        </div>
      </div>

      <div v-if="successMessage" class="alert alert-success mt-3" v-html="successMessage"></div>
      <div v-if="errorMessage" class="alert alert-danger mt-3" v-html="errorMessage"></div>

    </BaseLayout>
  </SetupGuard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue';
import SetupGuard from '../layouts/SetupGuard.vue';
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

const primaryPassword = ref('');
const newPassword = ref('');
const repeatPassword = ref('');
const backendUrl = ref('');
const successMessage = ref('');
const errorMessage = ref('');

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

const canSubmit = computed(() => {
  const allCriteria =
    criteriaMet.value.length && criteriaMet.value.special && criteriaMet.value.hasDigit && criteriaMet.value.hasLetter && criteriaMet.value.onlyValidChars && criteriaMet.value.match;
  const primaryOk =
    !settings.value.requirePasswordForPasswordChange || !!primaryPassword.value;
  return allCriteria && primaryOk;
});

// Dummy calls
async function saveResetPassword() {
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
    return; // stop here so you don’t also set successMessage
  }
}

async function updatePassword(userId: number, body: any, backendUrl: string, token: string) {
  if (backendUrl.endsWith('/')) {
    backendUrl = backendUrl.slice(0, -1);
  }

  const response = await fetch(`${backendUrl}/entries/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Login ${token}` // 👈 add your auth token here
    },
    body: JSON.stringify(body)
  });

  return response;
}
</script>
