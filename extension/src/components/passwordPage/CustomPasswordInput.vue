<template>
  <v-sheet class="mt-6">
    <!-- New password -->
    <v-input>
      <template #prepend>
        <p class="text-body-1 font-weight-medium" style="width:170px;">
          Secondary Password:
        </p>
      </template>

      <v-text-field
        v-model="newPassword"
        type="password"
        label="New secondary password"
        placeholder="New secondary password"
        variant="outlined"
        density="comfortable"
        style="max-width: 400px;"
      />
    </v-input>

    <!-- Repeat password (internal only) -->
    <v-input>
      <template #prepend>
        <p class="text-body-1 font-weight-medium" style="width:170px;">
          Repeat Password:
        </p>
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
          <v-icon :class="criteria.length ? 'text-success' : 'text-error'">
            {{ criteria.length ? 'mdi-check-circle' : 'mdi-close-circle' }}
          </v-icon>
        </template>
        Minimum length: {{ passwordLength }} characters
      </v-list-item>

      <v-list-item>
        <template #prepend>
          <v-icon :class="criteria.special ? 'text-success' : 'text-error'">
            {{ criteria.special ? 'mdi-check-circle' : 'mdi-close-circle' }}
          </v-icon>
        </template>
        Contains at least one special character (!@$%&*-_+=?.)
      </v-list-item>

      <v-list-item>
        <template #prepend>
          <v-icon :class="criteria.hasDigit ? 'text-success' : 'text-error'">
            {{ criteria.hasDigit ? 'mdi-check-circle' : 'mdi-close-circle' }}
          </v-icon>
        </template>
        Contains at least one digit (0-9)
      </v-list-item>

      <v-list-item>
        <template #prepend>
          <v-icon :class="criteria.hasLetter ? 'text-success' : 'text-error'">
            {{ criteria.hasLetter ? 'mdi-check-circle' : 'mdi-close-circle' }}
          </v-icon>
        </template>
        Contains at least one letter
      </v-list-item>

      <v-list-item>
        <template #prepend>
          <v-icon :class="criteria.onlyValidChars ? 'text-success' : 'text-error'">
            {{ criteria.onlyValidChars ? 'mdi-check-circle' : 'mdi-close-circle' }}
          </v-icon>
        </template>
        Contains only valid chars (letters, digits and special characters)
      </v-list-item>

      <v-list-item>
        <template #prepend>
          <v-icon :class="criteria.match ? 'text-success' : 'text-error'">
            {{ criteria.match ? 'mdi-check-circle' : 'mdi-close-circle' }}
          </v-icon>
        </template>
        Passwords match
      </v-list-item>
    </v-list>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";

const props = defineProps<{
  modelValue: string;        // the final password exposed to parent
  passwordLength: number;    // from settings
}>();

const emit = defineEmits([
    "update:modelValue",
    "valid"
]);

// Internal state
const newPassword = ref(props.modelValue);
const repeatPassword = ref("");

// Criteria logic
// TODO: Move special characters in string of AppConfig
const criteria = computed(() => ({
  length: newPassword.value.length >= props.passwordLength,
  special: /[!@$%&*\-_\+=?.]/.test(newPassword.value),
  hasDigit: /\d/.test(newPassword.value),
  hasLetter: /[A-Za-z]/.test(newPassword.value),
  onlyValidChars: /^[A-Za-z0-9!@$%&*\-_\+=?.]+$/.test(newPassword.value),
  match: newPassword.value && newPassword.value === repeatPassword.value,
}));

const allCriteriaMet = computed(() =>
  Object.values(criteria.value).every(Boolean)
);

// Sync newPassword → parent and vice versa
watch(newPassword, (val) => emit("update:modelValue", val));
watch(
  () => props.modelValue,
  (val) => {
    if (val !== newPassword.value) {
      newPassword.value = val;
    }
  }
);

onMounted(() => {
  emit("valid", allCriteriaMet.value);
});

// Expose only what parent needs
defineExpose({
  allCriteriaMet,
});

// Emit to the parent form
watch(allCriteriaMet, (val) => {
  emit("valid", val);
});

</script>
