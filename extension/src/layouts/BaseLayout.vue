<template>
  <v-container fluid class="pa-5 h-screen overflow-y-auto">
    <v-card elevation="1">
      <!-- title -->
      <v-card-title>
        <slot name="title" />
      </v-card-title>

      <v-card-subtitle>
        <slot name="subtitle" />
      </v-card-subtitle>

      <!-- main content -->
      <v-card-text>
        <slot />
      </v-card-text>

      <!-- footer -->
      <v-card-actions>
        <slot name="footer" />
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
// Nothing to do here...
</script>
