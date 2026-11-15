<script setup lang="ts">
/** Stands in for „Sicherung“ and „Einrichtung“ until the setup assistant exists: title and one note, no requests. */
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StatusLine from '../ui/StatusLine.vue';

const { t } = useI18n();
const route = useRoute();
</script>

<template>
    <h1>{{ t(route.meta.titleKey ?? 'app.name') }}</h1>
    <StatusLine
        kind="empty"
        :text="t('pages.comingSoon')"
    />
</template>
