<script setup lang="ts">
/**
 * Spec 7.2: the renewal popup was blocked or closed, or the token became unusable while a form held input. The button
 * opens the popup from a click; nothing on the page is reset meanwhile.
 */
import { useI18n } from 'vue-i18n';
import { useSession } from '../app/useSession';
import Banner from '../ui/Banner.vue';

const { t } = useI18n();
const session = useSession();

function renew(): void {
    // A blocked or closed popup keeps the banner (needsRenewal stays true); other failures surface on the next request.
    session.renew().catch(() => undefined);
}
</script>

<template>
    <Banner
        v-if="session.needsRenewal.value"
        kind="warning"
    >
        <p class="cps-session">
            <span>{{ t('session.expired') }}</span>
            <button
                type="button"
                class="cps-btn cps-btn--primary"
                @click="renew"
            >
                {{ t('session.renew') }}
            </button>
        </p>
    </Banner>
</template>

<style scoped>
.cps-session {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--cps-space-2) var(--cps-space-3);
    margin: 0;
}
</style>
