<template>
  <div>
    <p>This is the setup page.</p>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from 'vue';
import { useLayout } from '../layout/useLayout';

export default defineComponent({
  name: 'SetupPage',
  setup() {
    const { setTitle } = useLayout();
    onMounted(() => setTitle('Setup'));
  }
});
</script>
