<script setup lang="ts">
/**
 * The states without a page (spec 3.2): `no-access`, `update-needed`, `backend-error` and `version-mismatch`.
 * Problem details are plain text and only for settings editors (spec 8.2); users see short sentences.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { failureMessage, isSettingsEditor } from '../app/app-state';
import { useAppState } from '../app/useAppState';
import { SCHEMA_VERSION } from '../model/schemas';
import Banner from '../ui/Banner.vue';

const { t } = useI18n();
const app = useAppState();

const editor = computed(() => isSettingsEditor(app.settingsEditor.value));
const message = computed(() => (app.failure.value ? failureMessage(app.failure.value, editor.value) : null));
</script>

<template>
    <p v-if="app.state.value === 'no-access'">
        {{ t('state.noAccess') }}
    </p>
    <template v-else-if="app.state.value === 'update-needed'">
        <p>{{ t('state.updateNeeded') }}</p>
        <p v-if="editor || app.setupCapable.value">
            {{ t('state.updateVersions', { stored: app.storedSchema.value ?? '?', supported: SCHEMA_VERSION, app: app.appVersion }) }}
        </p>
    </template>
    <template v-else-if="app.state.value === 'backend-error' && message">
        <Banner kind="error">
            <!-- Plural texts („in einer Minute“ | „in {n} Minuten“) pick their form from the named `n`. -->
            <p>{{ t(message.key, message.params) }}</p>
            <details v-if="editor && message.detail">
                <summary>{{ t('state.details') }}</summary>
                <p>{{ message.detail }}</p>
            </details>
        </Banner>
        <p
            v-if="editor && app.failure.value?.kind === 'login'"
            class="cps-state__link"
        >
            <RouterLink
                to="/settings/backend"
                class="cps-link"
            >
                {{ t('state.toBackend') }}
            </RouterLink>
        </p>
        <p
            v-if="editor && app.failure.value?.kind === 'duplicates'"
            class="cps-state__link"
        >
            <RouterLink
                to="/settings"
                class="cps-link"
            >
                {{ t('state.toSettings') }}
            </RouterLink>
        </p>
        <p v-if="message.loginAction">
            <button
                type="button"
                class="cps-btn cps-btn--primary"
                @click="app.loginAgain()"
            >
                {{ t('state.loginAgain') }}
            </button>
        </p>
    </template>
    <template v-else-if="app.state.value === 'version-mismatch'">
        <Banner
            v-if="app.admin.value"
            kind="error"
        >
            <p>{{ t('state.versionMismatch', { app: app.appVersion, backend: app.backendVersion.value ?? '?' }) }}</p>
        </Banner>
        <p v-else>
            {{ t('state.updating') }}
        </p>
    </template>
</template>
