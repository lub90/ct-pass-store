<script setup lang="ts">
/**
 * `/auth/callback` (spec 7.1, E7) has no page of its own: the app's startup (`app/useAppState.ts`) hands a popup's
 * code to its opener or completes a page login, and leaves this route before any page is drawn. Reached later inside
 * the running app, there is nothing to finish, so it goes to `/`.
 */
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import StatusLine from '../ui/StatusLine.vue';

const { t } = useI18n();
const router = useRouter();

onMounted(() => void router.replace('/'));
</script>

<template>
    <StatusLine
        kind="loading"
        :text="t('auth.finishing')"
    />
</template>
