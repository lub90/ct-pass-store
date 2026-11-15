<script setup lang="ts">
/**
 * `setup-needed` and `migration-needed` (spec 3.3, 5.2): everyone sees the waiting text; setup-capable people also
 * learn that the setup assistant sets it up and isn't available yet (it replaces this page then).
 */
import { useI18n } from 'vue-i18n';
import Banner from '../ui/Banner.vue';

defineProps<{ setupCapable: boolean }>();
const { t } = useI18n();
</script>

<template>
    <p>{{ t('state.waiting') }}</p>
    <Banner
        v-if="setupCapable"
        kind="info"
    >
        <p>{{ t('state.setupNote') }}</p>
    </Banner>
</template>
