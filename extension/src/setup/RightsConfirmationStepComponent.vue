<template>
  <SetupStep title="Adjust access rights">
    <SetupInfoBox
      :visible="true"
      :content="`
        Now give yourself the rights to <strong>edit</strong>, <strong>delete</strong>, and <strong>view</strong> the custom data in all categories of this extension via ChurchTools' rights management.<br />
        <strong>You must do that manually.</strong> After that, please confirm below and continue with the next step of the setup.
      `"
    />

    <SetupCheckboxBox
      v-model="confirmed"
      :content="''"
      label="I have completed the rights assignment"
    />

  </SetupStep>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { defineEmits, watch } from 'vue';

import SetupStep from './SetupStep.vue';
import SetupInfoBox from './SetupInfoBox.vue';
import SetupCheckboxBox from './SetupCheckboxBox.vue';

const emit = defineEmits<{
  (e: 'completed'): void;
}>();

const confirmed = ref(false);

// Watch for checkbox change and emit immediately when checked
watch(confirmed, (val) => {
  if (val) emit('completed');
});
</script>
