<script setup lang="ts">
/**
 * „Mein Passwort“ (spec 4.2): state 1 here, states 2 and 3 in `PasswordFlow`. Always for the person logged into
 * ChurchTools (whoami), never for a person from the address. The page checks its own right (the app state allows the
 * person in) before it asks the backend anything.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { isSettingsEditor } from '../app/app-state';
import { useServices } from '../app/services';
import { useAppState } from '../app/useAppState';
import { useSession } from '../app/useSession';
import { PopupBlocked, PopupClosed } from '../backend/auth';
import { BackendProblem, problemMessageKey, problemParams } from '../backend/problems';
import { translate } from '../i18n';
import { pageTexts } from '../i18n/custom-texts';
import PasswordFlow from '../password/PasswordFlow.vue';
import { usePasswordEntry } from '../password/usePasswordEntry';
import Banner from '../ui/Banner.vue';
import PageHeader from '../ui/PageHeader.vue';
import Pill from '../ui/Pill.vue';
import StatusLine from '../ui/StatusLine.vue';

const { t } = useI18n();
const services = useServices();
const session = useSession();
const app = useAppState();

const settings = computed(() => app.settings.value);
const allowed = computed(() => (app.state.value === 'user' || app.state.value === 'admin') && app.personId.value !== null && settings.value !== null);
const entry = usePasswordEntry(() => (allowed.value ? app.personId.value : null));

// Plain text only: shown through text interpolation, never as HTML and never as a message of `t()` (spec 10.3).
const texts = computed(() => pageTexts(settings.value?.texts, services.language));
const detailed = computed(() => session.admin.value || isSettingsEditor(app.settingsEditor.value));

const flowOpen = ref(false);
const saved = ref(false);
const openError = ref<unknown>(null);

const problem = (error: unknown) => ({
    text: translate(t, problemMessageKey(error), problemParams(error)),
    detail: detailed.value && error instanceof BackendProblem && error.detail ? error.detail : undefined,
});
const loadProblem = computed(() => (entry.status.value === 'error' ? problem(entry.error.value) : null));
const openProblem = computed(() => (openError.value === null ? null : problem(openError.value)));

async function open(): Promise<void> {
    saved.value = false;
    openError.value = null;
    try {
        // Inside the click handler: a renewal popup needs the click (spec 7.2).
        await session.ensureFresh();
    } catch (error) {
        // A blocked or closed popup shows „Sitzung erneuern“.
        if (!(error instanceof PopupBlocked || error instanceof PopupClosed)) openError.value = error;
        return;
    }
    flowOpen.value = true;
}

/** Back to state 1, whatever happened in the flow: the status is read again, so the pill matches the backend. */
function done(outcome: 'cancelled' | 'saved' | 'generated'): void {
    flowOpen.value = false;
    saved.value = outcome === 'saved';
    void entry.reload();
}
</script>

<template>
    <PageHeader
        icon="key"
        :title="texts.title"
        :intro="texts.intro"
    />
    <div class="cps-password">
        <Banner
            v-if="!allowed"
            kind="warning"
        >
            <p>{{ t('state.noAccess') }}</p>
        </Banner>
        <PasswordFlow
            v-else-if="flowOpen && settings && app.personId.value !== null"
            :person-id="app.personId.value"
            :settings="settings"
            :has-entry="entry.status.value === 'set'"
            @done="done"
        />
        <StatusLine
            v-else-if="entry.status.value === 'loading'"
            kind="loading"
            :text="t('state.loading')"
        />
        <template v-else-if="loadProblem">
            <StatusLine
                kind="error"
                :text="loadProblem.text"
            />
            <details v-if="loadProblem.detail">
                <summary>{{ t('state.details') }}</summary>
                <p>{{ loadProblem.detail }}</p>
            </details>
            <div class="cps-form-actions">
                <button
                    type="button"
                    class="cps-btn cps-btn--ghost"
                    @click="entry.reload()"
                >
                    {{ t('password.retry') }}
                </button>
            </div>
        </template>
        <template v-else>
            <p>
                <Pill :kind="entry.status.value === 'set' ? 'ok' : 'neutral'">
                    {{ entry.status.value === 'set' ? t('password.isSet') : t('password.none') }}
                </Pill>
            </p>
            <p v-if="entry.status.value === 'set'">
                {{ t('password.cantShow') }}
            </p>
            <p
                v-if="saved"
                class="cps-password__saved"
                role="status"
            >
                {{ t('password.saved') }}
            </p>
            <div
                v-if="openProblem"
                class="cps-password__error"
                role="alert"
            >
                <p>{{ openProblem.text }}</p>
                <details v-if="openProblem.detail">
                    <summary>{{ t('state.details') }}</summary>
                    <p>{{ openProblem.detail }}</p>
                </details>
            </div>
            <div class="cps-form-actions">
                <button
                    type="button"
                    class="cps-btn cps-btn--primary"
                    @click="open"
                >
                    {{ entry.status.value === 'set' ? t('password.setNew') : t('password.setFirst') }}
                </button>
            </div>
            <p
                v-if="entry.status.value === 'set'"
                class="cps-password__hint"
            >
                {{ t('password.replaceHint') }}
            </p>
        </template>
    </div>
</template>

<style scoped>
.cps-password {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
    margin-top: var(--cps-space-5);
}
.cps-password p {
    margin: 0;
}
.cps-password__hint {
    color: var(--cps-text-muted);
    font-size: var(--cps-size-sm);
}
.cps-password__error {
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
</style>
