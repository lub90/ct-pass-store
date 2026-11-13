<template>
    <main>
        <h1>{{ $t('app.name') }}</h1>
        <p>{{ APP_VERSION }}</p>
    </main>
</template>

<script setup lang="ts">
import { APP_VERSION } from './config';
</script>
