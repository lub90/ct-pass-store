<script setup lang="ts">
/**
 * „Backend & Status“ (spec 4.8). Needs „edit custom data“ on `settings`, like the overview's card; without it nothing
 * is read and nothing is asked of the backend.
 *
 * The address: the field follows the rules of the store and the backend (`normalizeBackendUrl`). The save writes the
 * value as read with only `backendUrl` changed (everything else stays as stored, revision-guarded). Whoever sets this
 * address receives users' passwords (E15), so a change shows a warning and a danger dialog naming the old and the new
 * address before anything is written. The app keeps talking to the address of startup (`reloadSettings`): a new one
 * takes effect with the next page load, and the page says so.
 *
 * The self-test (`GET /v1/test`, admins only, as the backend requires): the read-only run once on open, then on the
 * buttons; the write test (`?write=1`) only on its own button. Every request goes through `services.backend` with the
 * address of startup, so the token only ever goes to the configured backend. A typed address is never contacted, not
 * even without a token: there is no pre-save reachability check (the self-test after the reload is that check).
 * Check names, messages and problem details are plain text.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { normalizeBackendUrl } from '../../admin/backend-url';
import { useSettingsForm } from '../../admin/useSettingsForm';
import { useServices } from '../../app/services';
import { useAppState } from '../../app/useAppState';
import { useSession } from '../../app/useSession';
import type { SelfTestResult } from '../../backend/api';
import { PopupBlocked, PopupClosed } from '../../backend/auth';
import { BackendProblem, problemMessageKey, problemParams } from '../../backend/problems';
import type { SettingsV2 } from '../../model/schemas';
import Banner from '../../ui/Banner.vue';
import Field from '../../ui/Field.vue';
import Pill from '../../ui/Pill.vue';
import StatusLine from '../../ui/StatusLine.vue';
import { useConfirm } from '../../ui/useConfirm';
import SettingsFormPage from './SettingsFormPage.vue';

const { t } = useI18n();
const services = useServices();
const session = useSession();
const app = useAppState();
const confirm = useConfirm();

const allowed = computed(() => app.settingsEditor.value.settings);
const admin = computed(() => app.state.value === 'admin');
/** The address the app runs with (startup); the only one ever asked. */
const runningUrl = computed(() => app.settings.value?.backendUrl ?? null);

// --- The address ---------------------------------------------------------------------------------------------------

const form = useSettingsForm<SettingsV2>(
    () => services.store.readSettings(),
    (value, revision) => services.store.saveSettings(value, revision),
    {
        beforeSave: async (next, previous) => {
            if (next.backendUrl === previous?.backendUrl) return true;
            const answer = await confirm({
                title: t('backend.confirmTitle'),
                text: t('backend.confirmText', { old: previous?.backendUrl ?? t('backend.noAddress'), new: next.backendUrl ?? t('backend.noAddress') }),
                confirmLabel: t('backend.confirm'),
                cancelLabel: t('common.cancel'),
                danger: true,
            });
            return answer.confirmed;
        },
        onSaved: () => app.reloadSettings(),
        confirm,
        leaveQuestion: () => ({ title: t('settings.leaveTitle'), text: t('settings.leaveText'), confirmLabel: t('settings.discard'), cancelLabel: t('settings.stay') }),
    },
);

// No repair here: this page writes the address only into a valid value (spec 4.4 „Stored problems“).
const unrepairable = computed(() => ({ text: `${t('backend.noRepair')} ${app.setupCapable.value ? t('settings.noRepairVersion') : t('settings.noRepairAsk')}` }));

watch(
    allowed,
    (ok) => {
        if (ok && form.status.value === 'idle') void form.load();
    },
    { immediate: true },
);

/** What is typed; the value holds the normalized address (or the raw text while it is refused, so Save stays off). */
const urlInput = ref('');
const checked = computed(() => normalizeBackendUrl(urlInput.value));
watch(urlInput, () => {
    const value = form.value.value;
    if (!value) return;
    value.backendUrl = checked.value.ok ? checked.value.url : urlInput.value;
});
watch(
    () => form.value.value?.backendUrl,
    (url) => {
        if (url === undefined) return;
        const typed = checked.value;
        if (!(typed.ok && typed.url === url) && urlInput.value !== url) urlInput.value = url;
    },
    { immediate: true },
);

const URL_ERRORS = { 'not-https': 'notHttps', credentials: 'credentials', query: 'query', fragment: 'fragment', invalid: 'invalid' } as const;
const urlError = computed(() => (checked.value.ok ? undefined : t(`backend.urlErrors.${URL_ERRORS[checked.value.reason]}`)));

/** The read value's address, to warn as soon as the field differs from it. */
const storedUrl = ref<string | null>(null);
watch(
    () => [form.status.value, form.savedAt.value] as const,
    () => {
        if (form.status.value === 'ready' && !form.dirty.value) storedUrl.value = form.value.value?.backendUrl ?? null;
    },
    { immediate: true },
);
const changed = computed(() => form.value.value !== null && checked.value.ok && checked.value.url !== storedUrl.value);
/** The stored address isn't the one the app runs with (saved here, or elsewhere since startup). */
const needsReload = computed(() => form.status.value === 'ready' && !form.dirty.value && storedUrl.value !== null && storedUrl.value !== runningUrl.value);

function reloadPage(): void {
    window.location.reload();
}

// --- Self-test -------------------------------------------------------------------------------------------------------

const SESSION_SLUGS = new Set(['token-expired', 'invalid-token', 'missing-token']);

const running = ref(false);
const outcome = shallowRef<{ result: SelfTestResult; write: boolean } | null>(null);
const runError = shallowRef<unknown>(null);
let alive = true;
onBeforeUnmount(() => (alive = false));

const passed = computed(() => outcome.value?.result.tests.filter((test) => test.status === 'ok').length ?? 0);
const version = computed(() => outcome.value?.result.version ?? app.backendVersion.value);
const shownError = computed(() => {
    const error = runError.value;
    if (error === null) return null;
    return { text: t(problemMessageKey(error), problemParams(error)), detail: error instanceof BackendProblem && error.detail ? error.detail : undefined };
});

/**
 * `interactive`: on a button, inside its click handler — `ensureFresh()` is the first call (a renewal popup needs
 * the click, spec 7.2) and a `token-expired` answer is retried once. On open: neither (no popup without a click).
 */
async function runSelfTest(write: boolean, interactive: boolean): Promise<void> {
    const url = runningUrl.value;
    if (!url || running.value || !admin.value || !allowed.value) return;
    running.value = true;
    runError.value = null;
    try {
        if (interactive) await session.ensureFresh();
        const api = services.backend(url);
        const result = interactive ? await session.call(() => api.selfTest(write)) : await api.selfTest(write);
        if (!alive) return;
        outcome.value = { result, write };
        // The overview's pill is the read-only test.
        if (!write) app.selfTestCache.value = { baseUrl: url, at: Date.now(), failed: result.tests.length - passed.value };
    } catch (error) {
        if (!alive) return;
        // A blocked or closed popup shows „Sitzung erneuern“ (the frame's banner); so does a token problem while it is up.
        if (error instanceof PopupBlocked || error instanceof PopupClosed) return;
        if (error instanceof BackendProblem && SESSION_SLUGS.has(error.slug) && session.needsRenewal.value) return;
        runError.value = error;
    } finally {
        running.value = false;
    }
}

let ranOnOpen = false;
watch(
    [allowed, admin, runningUrl],
    () => {
        if (ranOnOpen || !allowed.value || !admin.value || !runningUrl.value) return;
        ranOnOpen = true;
        void runSelfTest(false, false);
    },
    { immediate: true },
);
</script>

<template>
    <SettingsFormPage
        icon="server"
        :title="t('pages.backend')"
        :intro="t('backend.intro')"
        :allowed="allowed"
        :missing-right="t('settings.missingRight', { right: 'edit custom data', category: 'settings' })"
        :form="form"
        :unrepairable="unrepairable"
        :valid="checked.ok"
    >
        <template v-if="form.value.value">
            <Field
                id="cps-backend-url"
                v-slot="{ id, describedby, invalid }"
                :label="t('backend.urlLabel')"
                :help="t('backend.urlHelp')"
                :error="urlError"
            >
                <!-- Text, not `url`: browsers trim a url input, and what is typed is checked exactly as stored. -->
                <input
                    :id="id"
                    v-model="urlInput"
                    class="cps-backend__url"
                    type="text"
                    inputmode="url"
                    autocomplete="off"
                    spellcheck="false"
                    :aria-describedby="describedby"
                    :aria-invalid="invalid"
                >
            </Field>
            <Banner
                v-if="changed"
                kind="warning"
                class="cps-backend__warning"
                :title="t('backend.warningTitle')"
            >
                <p>{{ t('backend.warning') }}</p>
                <p>{{ t('backend.warningEffect') }}</p>
            </Banner>
        </template>
    </SettingsFormPage>
    <template v-if="allowed && form.status.value === 'ready'">
        <Banner
            v-if="needsReload"
            kind="info"
            class="cps-backend__reload"
        >
            <p>{{ t('backend.reloadNote') }}</p>
            <div class="cps-form-actions">
                <button
                    type="button"
                    class="cps-btn cps-btn--ghost"
                    @click="reloadPage"
                >
                    {{ t('backend.reload') }}
                </button>
            </div>
        </Banner>
    </template>
    <section
        v-if="allowed"
        class="cps-backend__selftest"
        aria-labelledby="cps-backend-selftest"
    >
        <h2 id="cps-backend-selftest">
            {{ t('backend.selfTest') }}
        </h2>
        <p
            v-if="!admin"
            class="cps-backend__muted"
        >
            {{ t('backend.adminsOnly') }}
        </p>
        <template v-else>
            <p
                v-if="runningUrl"
                class="cps-backend__tested cps-backend__muted"
            >
                {{ t('backend.tested', { url: runningUrl }) }}
            </p>
            <p
                v-if="version"
                class="cps-backend__version"
            >
                {{ t('backend.version', { version }) }}
            </p>
            <StatusLine
                v-if="running"
                kind="loading"
                :text="t('backend.running')"
            />
            <div
                v-if="shownError"
                class="cps-backend__error"
                role="alert"
            >
                <p>{{ shownError.text }}</p>
                <details v-if="shownError.detail">
                    <summary>{{ t('state.details') }}</summary>
                    <p>{{ shownError.detail }}</p>
                </details>
            </div>
            <template v-if="outcome">
                <p class="cps-backend__passed">
                    {{ t('backend.passed', { ok: passed, total: outcome.result.tests.length }) }}
                    <template v-if="outcome.write">
                        {{ t('backend.withWrite') }}
                    </template>
                </p>
                <ul class="cps-backend__checks">
                    <li
                        v-for="(check, i) in outcome.result.tests"
                        :key="i"
                        class="cps-backend__check"
                    >
                        <Pill :kind="check.status === 'ok' ? 'ok' : 'error'">
                            {{ check.status === 'ok' ? t('backend.checkOk') : t('backend.checkFail') }}
                        </Pill>
                        <span class="cps-backend__check-text">
                            <span class="cps-backend__check-name">{{ check.name }}</span>
                            <span class="cps-backend__check-message">{{ check.message }}</span>
                        </span>
                    </li>
                </ul>
            </template>
            <div class="cps-form-actions">
                <button
                    type="button"
                    class="cps-btn cps-btn--ghost"
                    :disabled="running"
                    @click="runSelfTest(false, true)"
                >
                    {{ t('backend.runAgain') }}
                </button>
            </div>
            <p class="cps-backend__write-help cps-backend__muted">
                {{ t('backend.writeHelp') }}
            </p>
            <div class="cps-form-actions">
                <button
                    type="button"
                    class="cps-btn cps-btn--ghost"
                    :disabled="running"
                    @click="runSelfTest(true, true)"
                >
                    {{ t('backend.runWrite') }}
                </button>
            </div>
        </template>
    </section>
</template>

<style scoped>
.cps-backend__url {
    width: 100%;
    max-width: 32rem;
}
.cps-backend__reload {
    margin-top: var(--cps-space-4);
}
.cps-backend__reload p {
    margin: 0;
}
.cps-backend__selftest {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-3);
    margin-top: var(--cps-space-6);
}
.cps-backend__selftest h2 {
    margin: 0;
    font-size: var(--cps-size);
    font-weight: var(--cps-weight-strong);
}
.cps-backend__selftest p {
    margin: 0;
}
.cps-backend__muted {
    color: var(--cps-text-muted);
    overflow-wrap: anywhere;
}
.cps-backend__checks {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.cps-backend__check {
    display: flex;
    align-items: flex-start;
    gap: var(--cps-space-3);
}
.cps-backend__check-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
}
.cps-backend__check-name {
    font-weight: var(--cps-weight-strong);
}
.cps-backend__error {
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
</style>
