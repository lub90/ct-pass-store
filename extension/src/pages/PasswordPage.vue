<template>
  <div>
    <p>This is the password page.</p>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from 'vue';
import { useLayout } from '../layout/useLayout';

export default defineComponent({
  name: 'PasswordPage',
  setup() {
    const { setTitle } = useLayout();
    onMounted(() => setTitle('Passwort'));
  }
});
</script>
