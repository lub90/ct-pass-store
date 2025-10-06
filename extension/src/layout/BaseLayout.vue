<template>
  <div class="bg-light min-vh-100 d-flex justify-content-center align-items-center" style="height: 100vh; padding: 1vw">
    <div class="card rounded-3 p-4" style="width: 100%; height: 100%">
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h1 class="mb-0 text-primary" id="lubl-title">{{ title }}</h1>
        <div id="lubl-menu-bar"><slot name="menu" /></div>
      </div>

      <div id="lubl-container" class="mb-4" style="height: 100%">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </div>

      <div id="lubl-footer"><slot name="footer" /></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, provide } from 'vue';

export default defineComponent({
  name: 'BaseLayout',
  setup() {
    const title = ref(''); // wird von Pages gesetzt
    provide('setTitle', (t: string) => (title.value = t));
    return { title };
  }
});
</script>
