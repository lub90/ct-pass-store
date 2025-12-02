<template>
  <form @submit.prevent="handleSave">
    <div v-if="saved" class="alert alert-success mb-3">
      ✅ Settings were successfully saved.
    </div>

    <div class="mb-3">
      <label class="form-label">Require primary password for secondary password change</label>
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" v-model="requireOldPassword" />
      </div>
    </div>

    <div class="mb-3">
      <label class="form-label">Allow custom passwords</label>
      <br />
      <small class="text-muted">
        If enabled, users can choose their own passwords. If disabled, passwords will be generated automatically and can only be reset.
      </small>
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" v-model="allowCustomPassword" />
      </div>
    </div>

    <div class="mb-3">
      <label class="form-label">Admin user IDs (comma-separated)</label>
      <br />
      <small class="text-muted">
        Admin users are users that are allowed to read, set and/or reset the secondary password for other users. <strong>Use this feature carefully!</strong>
      </small>
      <input type="text" class="form-control" v-model="adminUserInput" />
    </div>

    <div class="mb-3">
      <label class="form-label">Read access user IDs (comma-separated)</label>
      <br />
      <small class="text-muted">
        Read access users are users that are allowed to read the secondary password for other users. <strong>Use this feature carefully!</strong>
      </small>
      <input type="text" class="form-control" v-model="readAccessUserInput" />
    </div>

    <div class="mb-3">
      <label class="form-label">Minimum password length</label>
      <br />
      <small class="text-muted">
        Must be greater than 8.
      </small>
      <input type="number" class="form-control" v-model.number="passwordLength" min="8" />
    </div>

    <div class="mb-3">
      <label class="form-label">Backend URL</label>
      <br />
      <small class="text-muted">
        Including "https://...".
      </small>
      <input type="text" class="form-control" v-model="backendUrl" />
    </div>

    <button type="submit" class="btn btn-primary mt-3">Save Settings</button>
  </form>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ExtensionData } from '../api/ExtensionData';

const props = defineProps<{
  extensionData: ExtensionData;
  categoryName: string;
}>();

const emit = defineEmits<{
  (e: 'saved', payload: Record<string, any>): void;
  (e: 'error', error: unknown): void;
}>();

const requireOldPassword = ref(true);
const allowCustomPassword = ref(true);
const adminUserInput = ref('');
const readAccessUserInput = ref('');
const passwordLength = ref(12);
const backendUrl = ref('');
const saved = ref(false);

onMounted(async () => {
  try {
    const hasData = await props.extensionData.categoryHasData(props.categoryName);
    if (hasData) {
      const entry = await props.extensionData.getCategoryData(props.categoryName, true);
      const values = JSON.parse(entry.value);
      requireOldPassword.value = values.requirePasswordForPasswordChange ?? true;
      allowCustomPassword.value = values.allowCustomPassword ?? true;
      adminUserInput.value = (values.adminUsers ?? []).join(', ');
      readAccessUserInput.value = (values.readAccessUsers ?? []).join(', ');
      passwordLength.value = values.passwordLength ?? 12;
      backendUrl.value = values.backendUrl ?? '';
    }
  } catch (error) {
    console.warn('Could not load existing settings:', error);
  }
});

async function handleSave() {
  const adminUsers = adminUserInput.value
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id) && id >= 1);

  const readAccessUsers = readAccessUserInput.value
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id) && id >= 1);

  const payload = {
    requirePasswordForPasswordChange: requireOldPassword.value,
    allowCustomPassword: allowCustomPassword.value,
    adminUsers,
    readAccessUsers,
    passwordLength: passwordLength.value,
    backendUrl: backendUrl.value,
  };

  try {
    const hasData = await props.extensionData.categoryHasData(props.categoryName);

    if (hasData) {
      const existing = await props.extensionData.getCategoryData(props.categoryName);
      if (existing.length > 0) {
        const entry = existing[0];
        await props.extensionData.updateCategoryEntry(props.categoryName, entry.id, payload);
      } else {
        await props.extensionData.createCategoryEntry(props.categoryName, payload);
      }
    } else {
      await props.extensionData.createCategoryEntry(props.categoryName, payload);
    }

    saved.value = true;
    emit('saved', payload);
  } catch (error) {
    console.error('Failed to save settings:', error);
    emit('error', error);
  }
}

</script>
