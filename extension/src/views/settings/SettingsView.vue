<script setup lang="ts">
/**
 * The settings overview (spec 4.4): one card per settings page. A card the person can't use is shown disabled with
 * the missing ChurchTools right; „Sicherung“ and „Einrichtung“ are left out unless the person is an admin who is also
 * setup-capable (spec 3.1.3). Display only: ChurchTools and the backend decide every request.
 *
 * Two pills, each read only when the person may read it: the number of machine clients (`access`, for
 * editors of `access`) and the self-test (`GET /v1/test`, admins only — the backend answers it for admins only), sent
 * through `services.backend`, which carries the token only to the configured backend. The pill shows counts only,
 * never the backend's messages.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { isSettingsEditor } from '../../app/app-state';
import { useServices } from '../../app/services';
import { useAppState } from '../../app/useAppState';
import Banner from '../../ui/Banner.vue';
import type { IconName } from '../../ui/Icon.vue';
import LinkCard from '../../ui/LinkCard.vue';
import PageHeader from '../../ui/PageHeader.vue';

const { t } = useI18n();
const services = useServices();
const app = useAppState();

const admin = computed(() => app.state.value === 'admin');
const editor = computed(() => app.settingsEditor.value);
const allowed = computed(() => admin.value || isSettingsEditor(editor.value));
const canAccess = computed(() => editor.value.access);
const canSettings = computed(() => editor.value.settings);

type Pill = { text: string; kind: 'ok' | 'neutral' | 'warning' };

const clients = ref<number | null>(null);
const selfTest = ref<Pill | null>(null);

async function loadClients(): Promise<void> {
    try {
        const read = await services.store.readAccess();
        if (read.state === 'ok') clients.value = read.value.machineClients.length;
    } catch {
        // No pill: „Zugriff“ itself says what's wrong.
    }
}

/** How long a self-test result is reused when the person comes back to the overview. */
const SELF_TEST_TTL_MS = 5 * 60_000;

const selfTestPill = (failed: number): Pill =>
    failed === 0 ? { text: t('settings.selfTestOk'), kind: 'ok' } : { text: t('settings.selfTestProblems', { n: failed }), kind: 'warning' };

async function runSelfTest(baseUrl: string): Promise<void> {
    const cached = app.selfTestCache.value;
    if (cached && cached.baseUrl === baseUrl && Date.now() - cached.at < SELF_TEST_TTL_MS) {
        selfTest.value = selfTestPill(cached.failed);
        return;
    }
    try {
        // The read-only test; the write test (`?write=1`) runs only on request, on „Backend & Status“.
        const result = await services.backend(baseUrl).selfTest(false);
        const failed = result.tests.filter((test) => test.status === 'fail').length;
        app.selfTestCache.value = { baseUrl, at: Date.now(), failed };
        selfTest.value = selfTestPill(failed);
    } catch {
        // Not kept: the next visit asks again.
        selfTest.value = { text: t('settings.selfTestFailed'), kind: 'warning' };
    }
}

// Once per visit, and only what the person may read.
let loadedClients = false;
let ranSelfTest = false;
watch(
    [allowed, canAccess, admin, () => app.settings.value?.backendUrl],
    () => {
        if (!allowed.value) return;
        if (canAccess.value && !loadedClients) {
            loadedClients = true;
            void loadClients();
        }
        const url = app.settings.value?.backendUrl;
        if (admin.value && url && !ranSelfTest) {
            ranSelfTest = true;
            void runSelfTest(url);
        }
    },
    { immediate: true },
);

/** Row 4a (E1): the categories with several values, and the page that lets an editor choose one. */
const duplicates = computed(() => (app.failure.value?.kind === 'duplicates' ? app.failure.value.categories : []));
const DUPLICATE_PAGES = { settings: { to: '/settings/rules', page: 'pages.rules' }, access: { to: '/settings/access', page: 'pages.access' } } as const;

const missing = (category: 'settings' | 'access'): string => t('settings.missingRight', { right: 'edit custom data', category });

interface Card {
    to: string;
    icon: IconName;
    title: string;
    text: string;
    pill?: Pill | null;
    disabledReason?: string;
}

const cards = computed<Card[]>(() => {
    const list: Card[] = [
        { to: '/settings/rules', icon: 'lock', title: t('pages.rules'), text: t('settings.cards.rules'), disabledReason: canSettings.value ? undefined : missing('settings') },
        { to: '/settings/texts', icon: 'text', title: t('pages.texts'), text: t('settings.cards.texts'), disabledReason: canSettings.value ? undefined : missing('settings') },
        {
            to: '/settings/access',
            icon: 'shield',
            title: t('pages.access'),
            text: t('settings.cards.access'),
            pill: clients.value === null ? null : { text: t('settings.clients', { n: clients.value }), kind: 'neutral' },
            // The page needs the edit right (spec 4.7), admins too.
            disabledReason: canAccess.value ? undefined : missing('access'),
        },
        {
            to: '/settings/backend',
            icon: 'server',
            title: t('pages.backend'),
            text: t('settings.cards.backend'),
            pill: selfTest.value,
            disabledReason: canSettings.value ? undefined : missing('settings'),
        },
    ];
    // Spec 3.1.3: only for admins who are also setup-capable; hidden (not disabled) for everyone else.
    if (admin.value && app.setupCapable.value) {
        list.push(
            { to: '/settings/backup', icon: 'backup', title: t('pages.backup'), text: t('settings.cards.backup') },
            { to: '/settings/setup', icon: 'wrench', title: t('pages.setup'), text: t('settings.cards.setup') },
        );
    }
    return list;
});
</script>

<template>
    <PageHeader
        icon="settings"
        :title="t('settings.title')"
        :intro="t('settings.intro')"
    />
    <div class="cps-settings">
        <Banner
            v-if="!allowed"
            kind="warning"
        >
            <p>{{ t('state.needsEditor') }}</p>
        </Banner>
        <template v-else>
            <Banner
                v-if="duplicates.length > 0"
                kind="error"
                class="cps-settings__duplicates"
            >
                <p>{{ t('state.duplicates', { categories: duplicates.join(', ') }) }}</p>
                <p
                    v-for="category in duplicates"
                    :key="category"
                >
                    <RouterLink :to="DUPLICATE_PAGES[category].to">
                        {{ t(DUPLICATE_PAGES[category].page) }}
                    </RouterLink>
                </p>
            </Banner>
            <LinkCard
                v-for="card in cards"
                :key="card.to"
                :to="card.to"
                :icon="card.icon"
                :title="card.title"
                :text="card.text"
                :pill="card.pill?.text"
                :pill-kind="card.pill?.kind"
                :disabled-reason="card.disabledReason"
            />
        </template>
    </div>
</template>

<style scoped>
.cps-settings {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-3);
    margin-top: var(--cps-space-5);
}
.cps-settings p {
    margin: 0;
}
</style>
