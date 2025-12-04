<template>
  <SetupStep title="Setup PHP backend">
    <SetupInfoBox
      :visible="true"
    >
    <strong> You now need to setup the PHP backend for the CtPassStore extension!</strong> <br />
        Please follow the instructions <a href="https://github.com/lub90/ct-pass-store/blob/main/backend/docs/setup.md" target="_blank">here</a>. After you have done so confirm below.
    </SetupInfoBox>

    <SetupCheckboxBox
      v-model="confirmed"
      label="I have completed the PHP backend setup and the PHP backend is running"
    >
      Confirm to continue setup...
    </SetupCheckboxBox>

  </SetupStep>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { watch } from 'vue';

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
