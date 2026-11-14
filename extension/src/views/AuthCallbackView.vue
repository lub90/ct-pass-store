<script setup lang="ts">
/**
 * `/auth/callback` (spec 7.1, E7): no page of its own, only a status line. In a login popup it hands code and state
 * to the opener and closes; as a page it completes the login and goes to the remembered path.
 */
import { inject, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { AUTH_KEY, CALLBACK_WINDOW_KEY, callbackWindow, forwardPopupCallback } from '../backend/auth';
import StatusLine from '../ui/StatusLine.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = inject(AUTH_KEY);
const win = inject(CALLBACK_WINDOW_KEY, null) ?? callbackWindow();
const failed = ref(false);

onMounted(async () => {
    const query = { ...route.query };
    const handled = forwardPopupCallback(query, win);
    if (handled === 'forwarded' || handled === 'closed') return;
    if (handled === 'page' && auth) {
        try {
            await router.replace(await auth.completePageLogin(query));
            return;
        } catch {
            // The reason stays out of the page and the console; the text says what to do.
        }
    }
    failed.value = true;
    // The code is spent either way; keep it out of the address bar and the history.
    await router.replace({ path: route.path });
});
</script>

<template>
    <StatusLine
        v-if="failed"
        kind="error"
        :text="t('problems.loginFailed')"
    />
    <StatusLine
        v-else
        kind="loading"
        :text="t('auth.finishing')"
    />
</template>
