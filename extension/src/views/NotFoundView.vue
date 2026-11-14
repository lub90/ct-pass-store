<script setup lang="ts">
/** Any path that isn't a page (spec 4.1): says so and links back to `/`. */
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
    <h1>{{ t('notFound.title') }}</h1>
    <p>
        <RouterLink to="/">
            {{ t('notFound.back') }}
        </RouterLink>
    </p>
</template>
