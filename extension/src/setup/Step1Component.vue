<template>
  <div>
    <h3>Step 1</h3>
    <p>Hier wird etwas konfiguriert…</p>
    <button @click="markCompleted">Als abgeschlossen markieren</button>
  </div>
</template>

<script setup lang="ts">
import type { Precondition } from '../types/Precondition';

const emit = defineEmits<{
    (e: 'completed'): void;
}>();

function markCompleted() {
    emit('completed');
}

</script>
