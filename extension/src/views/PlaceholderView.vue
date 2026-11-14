<script setup lang="ts">
/** Stands in for a page built in a later step (Tasks 12 to 16): its title only, no content and no requests. */
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
