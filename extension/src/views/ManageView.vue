<script setup lang="ts">
/**
 * „Passwörter verwalten“ (spec 4.3): an admin searches a member of the users group, sees the status of their password,
 * sets a new one (the flow of 4.2 with a warning banner and, over an existing password, a confirm dialog) or deletes
 * it (a danger dialog, with the admin's own ChurchTools password inside it when the settings require it).
 *
 * The page checks its own right on top of the frame: nothing is read (neither ChurchTools nor the backend) unless the
 * app state is `admin`. The members are read once per visit, through the admin's ChurchTools session („view group“ on
 * the users group, 16.2 A5). A person comes only from that list: an id in the address that isn't a member (or isn't
 * an id) shows a notice and is never asked about. Names from ChurchTools are plain text everywhere.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { parsePersonId, searchUsers } from '../admin/manage';
import { isSettingsEditor } from '../app/app-state';
import { useServices } from '../app/services';
import { useAppState } from '../app/useAppState';
import { useSession } from '../app/useSession';
import { PopupBlocked, PopupClosed } from '../backend/auth';
import { BackendProblem, problemMessageKey, problemParams, retryMinutes } from '../backend/problems';
import { CtForbiddenError, CtRateLimitedError, NotAuthenticatedError } from '../ct/errors';
import PasswordFlow from '../password/PasswordFlow.vue';
import { usePasswordEntry } from '../password/usePasswordEntry';
import Banner from '../ui/Banner.vue';
import PageHeader from '../ui/PageHeader.vue';
import PersonPicker, { type PersonOption } from '../ui/PersonPicker.vue';
import Pill from '../ui/Pill.vue';
import StatusLine from '../ui/StatusLine.vue';
import { useConfirm, type ConfirmOptions } from '../ui/useConfirm';

const { t } = useI18n();
const services = useServices();
const session = useSession();
const app = useAppState();
const route = useRoute();
const router = useRouter();
const confirm = useConfirm();

const settings = computed(() => app.settings.value);
const allowed = computed(() => app.state.value === 'admin' && app.personId.value !== null && settings.value !== null);
const detailed = computed(() => session.admin.value || isSettingsEditor(app.settingsEditor.value));

// --- The members of the users group, once per visit -------------------------------------------------------------

type Members =
    | { state: 'loading' }
    | { state: 'ok'; list: PersonOption[] }
    /** `access` holds no value the person can see (not set up, or no „view custom category“ on it). */
    | { state: 'access-missing' }
    | { state: 'access-invalid' }
    | { state: 'error'; error: unknown; reading: 'access' | 'group' };

const members = ref<Members>({ state: 'loading' });
let loadRun = 0;

async function loadMembers(): Promise<void> {
    const mine = ++loadRun;
    members.value = { state: 'loading' };
    let reading: 'access' | 'group' = 'access';
    try {
        const access = await services.store.readAccess();
        if (mine !== loadRun) return;
        if (access.state === 'missing') {
            members.value = { state: 'access-missing' };
            return;
        }
        if (access.state !== 'ok') {
            members.value = { state: 'access-invalid' };
            return;
        }
        reading = 'group';
        const list = await services.ct.groupMembers(access.value.groups.users.groupId);
        if (mine === loadRun) members.value = { state: 'ok', list };
    } catch (error) {
        if (mine === loadRun) members.value = { state: 'error', error, reading };
    }
}

// Only once the app state allows it, and only once per visit (a new visit mounts the page again).
let loaded = false;
watch(
    allowed,
    (ok) => {
        if (!ok || loaded) return;
        loaded = true;
        void loadMembers();
    },
    { immediate: true },
);

/** Spec 8.1: a missing right is a warning banner naming it. */
const missingRight = computed(() => {
    const m = members.value;
    if (m.state === 'access-missing') return t('manage.accessMissing');
    if (m.state === 'access-invalid') return t('manage.accessInvalid');
    if (m.state !== 'error' || !(m.error instanceof CtForbiddenError)) return null;
    if (m.reading === 'group') return t('manage.missingGroupRight', { right: m.error.missing ?? 'view group' });
    return t('manage.missingAccessRight', { right: m.error.missing ?? 'view custom data' });
});
const loadError = computed(() => {
    const m = members.value;
    if (m.state !== 'error') return null;
    if (m.error instanceof NotAuthenticatedError) return t('manage.ctLoggedOut');
    if (m.error instanceof CtRateLimitedError) return t('state.ctRateLimited', { n: retryMinutes(m.error.retryAfterMs / 1000) });
    return t('state.ctUnavailable');
});

const list = computed(() => (members.value.state === 'ok' ? members.value.list : []));
const find = (query: string): Promise<PersonOption[]> => Promise.resolve(searchUsers(list.value, query));

// --- The selected person: from the address, but only a member -------------------------------------------------------

const rawParam = computed(() => route.params.personId);
const hasParam = computed(() => rawParam.value !== undefined && rawParam.value !== '');
const selected = computed<PersonOption | null>(() => {
    const id = parsePersonId(rawParam.value);
    return id === null ? null : (list.value.find((m) => m.id === id) ?? null);
});
const notInGroup = computed(() => members.value.state === 'ok' && hasParam.value && selected.value === null);
const isSelf = computed(() => selected.value !== null && selected.value.id === app.personId.value);

const picked = computed<PersonOption | null>({
    get: () => selected.value,
    set: (person) => {
        if (person) void router.replace(`/manage/${person.id}`);
        else if (hasParam.value) void router.replace('/manage');
    },
});

const entry = usePasswordEntry(() => (allowed.value && selected.value ? selected.value.id : null));

const flowOpen = ref(false);
/**
 * Whether the flow must ask before replacing (spec 4.3). Fails closed: true unless the status was known to be „none“
 * when the flow opened, and once true it stays true while the flow is open — a status being read again (`loading`) or
 * failing (`error`) after an attempt never lets a resubmit skip the dialog.
 */
const flowHasEntry = ref(true);
watch(
    () => entry.status.value,
    (status) => {
        if (flowOpen.value && status !== 'none') flowHasEntry.value = true;
    },
);
const busy = ref(false);
/** A click is being handled (renewal, dialog): a second click does nothing. */
const pending = ref(false);
let alive = true;
onBeforeUnmount(() => {
    alive = false;
});
const done = ref<'saved' | 'deleted' | null>(null);
const actionError = ref<unknown>(null);

// Another person: whatever was open for the previous one closes (the flow drops its plaintext when it unmounts).
watch(
    () => selected.value?.id,
    () => {
        flowOpen.value = false;
        done.value = null;
        actionError.value = null;
    },
);

const SESSION_SLUGS = new Set(['token-expired', 'invalid-token', 'missing-token']);

const problem = (error: unknown) => ({
    text: t(problemMessageKey(error), problemParams(error)),
    detail: detailed.value && error instanceof BackendProblem && error.detail ? error.detail : undefined,
});
const loadProblem = computed(() => (entry.status.value === 'error' ? problem(entry.error.value) : null));
const shownError = computed(() => (actionError.value === null ? null : problem(actionError.value)));

/** A blocked or closed popup shows „Sitzung erneuern“ (the frame's banner); so does a token problem while it is up. */
function showError(error: unknown): void {
    if (error instanceof PopupBlocked || error instanceof PopupClosed) return;
    if (error instanceof BackendProblem && SESSION_SLUGS.has(error.slug) && session.needsRenewal.value) return;
    actionError.value = error;
}

async function openFlow(): Promise<void> {
    const person = selected.value;
    if (!person || pending.value) return;
    pending.value = true;
    done.value = null;
    actionError.value = null;
    try {
        // Inside the click handler: a renewal popup needs the click (spec 7.2).
        await session.ensureFresh();
    } catch (error) {
        showError(error);
        return;
    } finally {
        pending.value = false;
    }
    if (!alive || selected.value?.id !== person.id) return;
    flowHasEntry.value = entry.status.value !== 'none';
    flowOpen.value = true;
}

function flowDone(outcome: 'cancelled' | 'saved' | 'generated'): void {
    flowOpen.value = false;
    done.value = outcome === 'saved' ? 'saved' : null;
    void entry.reload();
}

async function remove(): Promise<void> {
    const person = selected.value;
    if (!person || busy.value || pending.value || !settings.value) return;
    pending.value = true;
    try {
        await removeFor(person, settings.value.requirePasswordForPasswordChange);
    } finally {
        pending.value = false;
    }
}

async function removeFor(person: PersonOption, requirePrimary: boolean): Promise<void> {
    done.value = null;
    actionError.value = null;
    try {
        // Before the dialog, inside the click handler (spec 7.2).
        await session.ensureFresh();
    } catch (error) {
        showError(error);
        return;
    }
    const question: ConfirmOptions = {
        title: t('manage.deleteTitle'),
        text: t('manage.deleteText', { name: person.name }),
        confirmLabel: t('manage.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
    };
    // The admin's own ChurchTools password (backend spec 4.6), typed inside the dialog; the dialog clears it.
    if (requirePrimary) question.field = { label: t('password.primaryLabel'), type: 'password' };
    const answer = await confirm(question);
    // Left the page or chose someone else meanwhile (the dialog outlives the page): nothing is sent.
    if (!answer.confirmed || !alive || selected.value?.id !== person.id) return;
    busy.value = true;
    try {
        await entry.remove(requirePrimary ? (answer.value ?? '') : undefined);
        done.value = 'deleted';
    } catch (error) {
        showError(error);
    } finally {
        busy.value = false;
    }
}

/** Oneself gets the labels of 4.2; someone else „Neues Passwort“. */
const newLabel = computed(() => {
    if (!isSelf.value) return t('manage.newPassword');
    return entry.status.value === 'set' ? t('password.setNew') : t('password.setFirst');
});

/** Up to two letters for the avatar: the first of the first and of the last name part. */
function initials(name: string): string {
    const words = name.split(/\s+/u).filter((w) => w !== '');
    const first = Array.from(words[0] ?? '')[0] ?? '';
    const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
    return (first + last).toLocaleUpperCase('de');
}
</script>

<template>
    <PageHeader
        icon="people"
        :title="t('manage.title')"
        :intro="t('manage.intro')"
    />
    <div class="cps-manage">
        <Banner
            v-if="!allowed"
            kind="warning"
        >
            <p>{{ t('state.needsAdmin') }}</p>
        </Banner>
        <StatusLine
            v-else-if="members.state === 'loading'"
            kind="loading"
            :text="t('state.loading')"
        />
        <Banner
            v-else-if="missingRight"
            kind="warning"
        >
            <p>{{ missingRight }}</p>
        </Banner>
        <template v-else-if="loadError">
            <StatusLine
                kind="error"
                :text="loadError"
            />
            <div class="cps-form-actions">
                <button
                    type="button"
                    class="cps-btn cps-btn--ghost"
                    @click="loadMembers"
                >
                    {{ t('password.retry') }}
                </button>
            </div>
        </template>
        <template v-else>
            <PersonPicker
                v-if="!flowOpen"
                v-model:selected="picked"
                :search="find"
                :label="t('manage.search')"
                :placeholder="t('manage.searchPlaceholder')"
                :empty-text="t('manage.noHits')"
            />
            <StatusLine
                v-if="notInGroup"
                kind="empty"
                :text="t('manage.notInGroup')"
            />
            <StatusLine
                v-else-if="!selected"
                kind="empty"
                :text="t('manage.pick')"
            />
            <section
                v-else
                class="cps-manage__person"
            >
                <div class="cps-manage__who">
                    <span
                        class="cps-manage__avatar"
                        aria-hidden="true"
                    >{{ initials(selected.name) }}</span>
                    <span class="cps-manage__name">{{ selected.name }}</span>
                    <Pill
                        v-if="entry.status.value === 'set' || entry.status.value === 'none'"
                        :kind="entry.status.value === 'set' ? 'ok' : 'neutral'"
                    >
                        {{ entry.status.value === 'set' ? t('password.isSet') : t('password.none') }}
                    </Pill>
                </div>

                <PasswordFlow
                    v-if="flowOpen && settings"
                    :key="selected.id"
                    :person-id="selected.id"
                    :for-name="isSelf ? undefined : selected.name"
                    :settings="settings"
                    :has-entry="flowHasEntry"
                    @done="flowDone"
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
                    <p
                        v-if="done"
                        class="cps-manage__saved"
                        role="status"
                    >
                        {{ done === 'saved' ? t('password.saved') : t('manage.deleted') }}
                    </p>
                    <div
                        v-if="shownError"
                        class="cps-manage__error"
                        role="alert"
                    >
                        <p>{{ shownError.text }}</p>
                        <details v-if="shownError.detail">
                            <summary>{{ t('state.details') }}</summary>
                            <p>{{ shownError.detail }}</p>
                        </details>
                    </div>
                    <div class="cps-form-actions">
                        <button
                            type="button"
                            class="cps-btn cps-btn--primary"
                            :disabled="busy || pending"
                            @click="openFlow"
                        >
                            {{ newLabel }}
                        </button>
                        <!-- Not for oneself: an admin on their own entry gets the flow of 4.2, which has no delete (E9). -->
                        <button
                            v-if="!isSelf && entry.status.value === 'set'"
                            type="button"
                            class="cps-btn cps-btn--danger"
                            :disabled="busy || pending"
                            @click="remove"
                        >
                            {{ t('manage.delete') }}
                        </button>
                    </div>
                    <p
                        v-if="isSelf && entry.status.value === 'set'"
                        class="cps-manage__hint"
                    >
                        {{ t('password.replaceHint') }}
                    </p>
                </template>
            </section>
        </template>
    </div>
</template>

<style scoped>
.cps-manage {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
    margin-top: var(--cps-space-5);
}
.cps-manage p {
    margin: 0;
}
.cps-manage__person {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
    padding-top: var(--cps-space-4);
    border-top: 1px solid var(--cps-divider);
}
.cps-manage__who {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--cps-space-3);
}
.cps-manage__avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--cps-accent-pale);
    color: var(--cps-text);
    font-weight: var(--cps-weight-strong);
}
.cps-manage__name {
    font-weight: var(--cps-weight-strong);
    overflow-wrap: anywhere;
}
.cps-manage__hint {
    color: var(--cps-text-muted);
    font-size: var(--cps-size-sm);
}
.cps-manage__error {
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
</style>
