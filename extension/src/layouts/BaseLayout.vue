<template>
  <v-container fluid class="pa-5 h-screen">
    <!-- Header -->
    <v-card class="h-100 " elevation="1">
      <!-- Titel -->
      <v-card-title>
        <slot name="title" />
      </v-card-title>

      <v-card-subtitle>
        <slot name="subtitle" />
      </v-card-subtitle>

      <!-- Hauptinhalt -->
      <v-card-text>
        <slot />
      </v-card-text>

      <!-- Footer -->
      <v-card-actions>
        <slot name="footer" />
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
// Nothing to do here...
</script>
