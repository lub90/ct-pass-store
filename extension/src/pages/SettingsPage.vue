<template>
  <div>
    <p>This is the settings page.</p>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from 'vue';
import { useLayout } from '../layout/useLayout';

export default defineComponent({
  name: 'SettingsPage',
  setup() {
    const { setTitle } = useLayout();
    onMounted(() => setTitle('Settings'));
  }
});
</script>
