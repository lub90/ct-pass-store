<template>
  <div class="d-flex justify-content-between align-items-center mb-4">
    <h1 class="mb-0 text-primary" id="title"><slot name="title" /></h1>
    <div id="menu"><slot name="menu" /></div>
  </div>

  <div id="container" class="mb-4" style="height: 100%">
    <slot />
  </div>

  <div id="footer"><slot name="footer" /></div>
</template>

<script setup lang="ts">
// Nothing to do here...
</script>
