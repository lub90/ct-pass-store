<script setup lang="ts">
/**
 * „Zugriff“ (spec 4.7). Needs „edit custom data“ on `access` (spec 3.1, 8.1); without it nothing is read.
 *
 * - The users and admins groups (from `access.groups`): name, active member count, a link to the group in ChurchTools
 *   (built from the ChurchTools base URL and the group id only). A group ChurchTools doesn't know any more, or one
 *   the person may not see, shows the error. „Gruppe ändern“ comes with the setup assistant (spec 12.6, 16.5).
 * - Every stored machine client entry, from the store's `clientEntries`: those the backend enables („aktiv“), and
 *   those it disables („falsch konfiguriert“, USER DECISION 2026-11-14) with their reasons. Each row shows the name
 *   (isolated, `<bdi>`), the permission, when and by whom it was created, and a fingerprint per key, so look-alikes
 *   can be told apart. Also when the value is invalid as a whole: the backend may still enable clients then (F1).
 * - Removal: a dangerous confirm that names every entry the removal would turn on (a duplicate id or a shared key
 *   disables both entries; removing one enables the other). The store removes exactly that entry (revision, index,
 *   raw id and the entry as read) and changes nothing else, so this works on an invalid value too, as long as it has
 *   a usable revision.
 *
 * Every name, id and group name is plain text.
 */
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { cut, describeEntry, groupPageUrl, isolate, newlyEnabled, type EntryInfo } from '../../admin/machine-clients';
import { settingsErrorText } from '../../admin/useSettingsForm';
import { useServices } from '../../app/services';
import { useAppState } from '../../app/useAppState';
import { instanceBaseUrl } from '../../ct/client';
import { CtForbiddenError, CtHttpError } from '../../ct/errors';
import { ConflictError } from '../../model/errors';
import type { AccessV2 } from '../../model/schemas';
import type { ClientEntry, Read } from '../../store/repository';
import Banner from '../../ui/Banner.vue';
import PageHeader from '../../ui/PageHeader.vue';
import StatusLine from '../../ui/StatusLine.vue';
import { useConfirm } from '../../ui/useConfirm';

type Role = 'users' | 'admins';
type GroupView =
    | { state: 'loading'; id: number }
    | { state: 'ok'; id: number; name: string; count: number }
    | { state: 'gone' | 'hidden' | 'error'; id: number };

const { t } = useI18n();
const services = useServices();
const app = useAppState();
const router = useRouter();
const confirm = useConfirm();
const uid = useId();

const allowed = computed(() => app.settingsEditor.value.access);
const ctBase = services.ctBaseUrl ?? instanceBaseUrl();

const read = shallowRef<Read<AccessV2> | null>(null);
const loadError = shallowRef<unknown>(null);
const groups = ref<Partial<Record<Role, GroupView>>>({});
/** Names of the clients' creators; `null`: ChurchTools doesn't show that person (gone, or not visible). */
const creators = ref<Record<number, string | null>>({});
const busy = ref(false);
const actionError = ref<string | null>(null);
const conflict = ref(false);
const done = ref(false);
let run = 0;
let alive = true;
onBeforeUnmount(() => {
    alive = false;
});

const message = (error: unknown): string => {
    const { key, params } = settingsErrorText(error, 'access');
    return t(key, params);
};

async function load(): Promise<void> {
    const mine = ++run;
    read.value = null;
    loadError.value = null;
    try {
        const r = await services.store.readAccess();
        if (mine !== run) return;
        read.value = r;
        if (r.state === 'ok') void loadGroups(r.value, mine);
        if (r.state === 'ok' || r.state === 'invalid') void loadCreators(r.clientEntries ?? [], mine);
    } catch (e) {
        if (mine !== run) return;
        loadError.value = e;
    }
}

/** The reload a conflict offers: the old outcome goes with the old read. */
function reload(): void {
    conflict.value = false;
    actionError.value = null;
    done.value = false;
    void load();
}

async function loadGroup(role: Role, id: number, mine: number): Promise<void> {
    let view: GroupView;
    try {
        const g = await services.ct.group(id);
        view = { state: 'ok', id, name: g.name, count: g.memberCount };
    } catch (e) {
        view = { state: e instanceof CtHttpError && e.status === 404 ? 'gone' : e instanceof CtForbiddenError ? 'hidden' : 'error', id };
    }
    if (mine === run) groups.value = { ...groups.value, [role]: view };
}

/** Only the users and admins groups; the service user's group is shown on „Einrichtung“. */
async function loadGroups(value: AccessV2, mine: number): Promise<void> {
    const roles: Role[] = ['users', 'admins'];
    groups.value = Object.fromEntries(roles.map((role) => [role, { state: 'loading', id: value.groups[role].groupId }]));
    await Promise.all(roles.map((role) => loadGroup(role, value.groups[role].groupId, mine)));
}

async function loadCreators(list: readonly ClientEntry[], mine: number): Promise<void> {
    const ids = [...new Set(list.map((e) => describeEntry(e.raw).createdBy).filter((id): id is number => id !== undefined))].filter((id) => !(id in creators.value));
    const found = await Promise.all(
        ids.map((id) =>
            services.ct.person(id).then(
                (p) => [id, p.name || null] as const,
                () => [id, null] as const,
            ),
        ),
    );
    if (mine === run) creators.value = { ...creators.value, ...Object.fromEntries(found) };
}

watch(
    allowed,
    (ok) => {
        if (ok && read.value === null && loadError.value === null) void load();
    },
    { immediate: true },
);

const value = computed(() => (read.value?.state === 'ok' ? read.value.value : null));
interface Row {
    entry: ClientEntry;
    info: EntryInfo;
}
const rows = computed<Row[]>(() => {
    const r = read.value;
    const list = r?.state === 'ok' || r?.state === 'invalid' ? (r.clientEntries ?? []) : [];
    return list.map((entry) => ({ entry, info: describeEntry(entry.raw) }));
});
const active = computed(() => rows.value.filter((row) => row.entry.client !== undefined));
const broken = computed(() => rows.value.filter((row) => row.entry.reasons.length > 0));
/** The revision a removal compares; `null`: nothing can be removed (no usable revision). */
const revision = computed<number | null>(() => {
    const r = read.value;
    if (r?.state === 'ok') return r.value.revision;
    return r?.state === 'invalid' && r.clientsRevision !== undefined && r.clientEntries ? r.clientsRevision : null;
});
/** What an `ok` read dropped other than whole entries (unknown permissions): gone with the next save of the form. */
const dropped = computed(() => (read.value?.state === 'ok' ? (read.value.issues ?? []).filter((i) => !/^machineClients\.\d+: /.test(i)) : []));
const invalidIssues = computed(() => (read.value?.state === 'invalid' ? read.value.issues : []));
const setupFix = computed(() => (app.setupCapable.value ? t('settings.noRepairVersion') : t('settings.noRepairAsk')));

const MAX_SHOWN_ID = 40;
const shownId = (id: string): string => cut(id, MAX_SHOWN_ID);

const groupText = (view: GroupView): string => {
    if (view.state === 'gone') return `${t('access.groupGone', { id: view.id })} ${app.setupCapable.value ? t('access.groupFixSetup') : t('access.groupFixAsk')}`;
    if (view.state === 'hidden') return t('access.groupHidden', { id: view.id });
    return t('state.ctUnavailable');
};

const creatorName = (id: number): string => creators.value[id] ?? t('access.personById', { id });
const fingerprintText = (fp: string | null): string => fp ?? t('access.keyInvalid');
const permissionText = (info: EntryInfo): string => (info.canRead ? t('access.canRead') : t('access.canNothing'));

/** Writes, then shows the outcome; on success the page reads again. A conflict writes nothing. */
async function write(save: () => Promise<void>): Promise<void> {
    actionError.value = null;
    conflict.value = false;
    done.value = false;
    try {
        await save();
    } catch (e) {
        if (!alive) return;
        if (e instanceof ConflictError) conflict.value = true;
        else actionError.value = message(e);
        return;
    }
    if (!alive) return;
    await load();
    done.value = true;
}

/** The question's text: what removing does, and every entry it would turn on (F2). */
function questionText(row: Row): string {
    const parts = [row.entry.client ? t('access.removeText') : t('access.brokenRemoveText')];
    if (row.entry.reasons.includes('duplicate-id')) parts.push(t('access.duplicateHint'));
    const all = rows.value;
    const turnsOn = newlyEnabled(
        all.map((x) => x.entry.raw),
        [row.entry.index],
    ).map((i) => all[i]!);
    if (turnsOn.length > 0) {
        const items = turnsOn.map(({ entry, info }) =>
            t('access.turnsOnItem', {
                name: isolate(info.name === undefined ? '–' : cut(info.name, MAX_SHOWN_ID)),
                id: isolate(entry.id === undefined ? '–' : shownId(entry.id)),
                permission: permissionText(info),
                keys: info.fingerprints.map(fingerprintText).join(', '),
            }),
        );
        parts.push(t('access.turnsOn', { list: items.join('; ') }));
    }
    return parts.join(' ');
}

async function remove(row: Row): Promise<void> {
    const r = read.value;
    const expected = revision.value;
    if (busy.value || expected === null) return;
    const { entry } = row;
    busy.value = true;
    try {
        const answer = await confirm({
            title: entry.client ? t('access.removeTitle') : t('access.brokenRemoveTitle'),
            text: questionText(row),
            confirmLabel: t('access.remove'),
            cancelLabel: t('common.cancel'),
            danger: true,
            subject: entry.client
                ? { name: isolate(entry.client.name), detail: entry.client.id }
                : { name: t('access.brokenEntry', { n: entry.index + 1 }), ...(entry.id === undefined ? {} : { detail: isolate(shownId(entry.id)) }) },
        });
        // Left the page or read again meanwhile: nothing is sent.
        if (!answer.confirmed || !alive || read.value !== r) return;
        const ref = entry.id === undefined ? { index: entry.index, entry: entry.raw } : { index: entry.index, id: entry.id, entry: entry.raw };
        await write(() => services.store.removeClients(expected, [ref]));
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <p class="cps-access__back">
        <RouterLink to="/settings">
            {{ t('settings.back') }}
        </RouterLink>
    </p>
    <PageHeader
        icon="shield"
        :title="t('pages.access')"
        :intro="t('access.intro')"
    />
    <div class="cps-access">
        <Banner
            v-if="!allowed"
            kind="warning"
        >
            <p>{{ t('settings.missingRight', { right: 'edit custom data', category: 'access' }) }}</p>
        </Banner>
        <template v-else>
            <Banner
                kind="warning"
                class="cps-access__warning"
            >
                <p>{{ t('access.warning') }}</p>
                <p>{{ t('access.warningAdmins') }}</p>
            </Banner>
            <template v-if="loadError !== null">
                <StatusLine
                    kind="error"
                    :text="message(loadError)"
                />
                <div class="cps-form-actions">
                    <button
                        type="button"
                        class="cps-btn cps-btn--ghost"
                        @click="load()"
                    >
                        {{ t('password.retry') }}
                    </button>
                </div>
            </template>
            <StatusLine
                v-else-if="read === null"
                kind="loading"
                :text="t('state.loading')"
            />
            <StatusLine
                v-else-if="read.state === 'missing'"
                kind="empty"
                :text="t('access.missing')"
            />
            <StatusLine
                v-else-if="read.state === 'newer'"
                kind="empty"
                :text="t('access.newer')"
            />
            <template v-else>
                <Banner
                    v-if="read.state === 'invalid'"
                    kind="error"
                    class="cps-access__invalid"
                    :title="t('access.invalidTitle')"
                >
                    <ul>
                        <li
                            v-for="(issue, i) in invalidIssues"
                            :key="i"
                        >
                            {{ issue }}
                        </li>
                    </ul>
                    <p>{{ setupFix }}</p>
                    <p v-if="rows.length > 0">
                        {{ revision === null ? t('access.noRemove') : t('access.stillActive') }}
                    </p>
                </Banner>
                <Banner
                    v-if="dropped.length > 0"
                    kind="warning"
                    class="cps-access__dropped"
                    :title="t('settings.issuesTitle')"
                >
                    <ul>
                        <li
                            v-for="(issue, i) in dropped"
                            :key="i"
                        >
                            {{ issue }}
                        </li>
                    </ul>
                    <p>{{ t('settings.issuesNote') }}</p>
                </Banner>

                <p
                    v-if="conflict"
                    class="cps-access__error"
                    role="alert"
                >
                    {{ t('settings.conflict') }}
                    <button
                        type="button"
                        class="cps-btn cps-btn--ghost"
                        @click="reload()"
                    >
                        {{ t('settings.reload') }}
                    </button>
                </p>
                <p
                    v-else-if="actionError"
                    class="cps-access__error"
                    role="alert"
                >
                    {{ actionError }}
                </p>
                <p
                    v-else-if="done"
                    class="cps-access__done"
                    role="status"
                >
                    {{ t('access.removed') }}
                </p>

                <section
                    v-if="value"
                    class="cps-access__section"
                >
                    <h2 class="cps-access__heading">
                        {{ t('access.groupsTitle') }}
                    </h2>
                    <div
                        v-for="role in (['users', 'admins'] as const)"
                        :key="role"
                        class="cps-access__group"
                        :data-role="role"
                    >
                        <p class="cps-access__role">
                            {{ t(`access.roles.${role}`) }}
                        </p>
                        <template v-if="groups[role]?.state === 'ok'">
                            <p>
                                <bdi class="cps-access__group-name">{{ groups[role].name }}</bdi>
                                ·
                                <span class="cps-access__group-count">{{ t('access.members', { n: groups[role].count }) }}</span>
                            </p>
                        </template>
                        <p
                            v-else-if="groups[role] && groups[role].state !== 'loading'"
                            class="cps-access__group-error"
                            role="alert"
                        >
                            {{ groupText(groups[role]) }}
                        </p>
                        <p
                            v-else
                            class="cps-access__muted cps-access__group-loading"
                        >
                            {{ t('state.loading') }}
                        </p>
                        <p class="cps-access__muted">
                            {{ t('access.membersHint') }}
                            <a
                                v-if="groupPageUrl(ctBase, value.groups[role].groupId)"
                                class="cps-access__group-link"
                                :href="groupPageUrl(ctBase, value.groups[role].groupId) ?? undefined"
                                target="_blank"
                                rel="noopener noreferrer"
                            >{{ t('access.openInCt') }}</a>
                        </p>
                        <div class="cps-access__group-actions">
                            <button
                                type="button"
                                class="cps-btn cps-btn--ghost"
                                disabled
                                :aria-describedby="`${uid}-${role}-later`"
                            >
                                {{ t('access.changeGroup') }}
                            </button>
                            <span
                                :id="`${uid}-${role}-later`"
                                class="cps-access__muted"
                            >{{ t('access.changeGroupLater') }}</span>
                        </div>
                    </div>
                </section>

                <section
                    v-if="value || active.length > 0"
                    class="cps-access__section"
                >
                    <h2 class="cps-access__heading">
                        {{ t('access.clientsTitle') }}
                    </h2>
                    <p
                        v-if="active.length === 0"
                        class="cps-access__clients-empty cps-access__muted"
                    >
                        {{ t('access.clientsEmpty') }}
                    </p>
                    <ul
                        v-else
                        class="cps-access__clients"
                    >
                        <li
                            v-for="row in active"
                            :key="row.entry.index"
                            class="cps-access__client"
                            :data-client-id="row.entry.client!.id"
                        >
                            <div class="cps-access__client-text">
                                <p>
                                    <bdi class="cps-access__client-name">{{ row.entry.client!.name }}</bdi>
                                    <span class="cps-access__client-id">{{ row.entry.client!.id }}</span>
                                </p>
                                <p class="cps-access__muted">
                                    {{ permissionText(row.info) }}
                                    · {{ t('access.keys', { n: row.entry.client!.publicKeys.length }) }}
                                    · <span class="cps-access__created">{{ t('access.created', { date: row.entry.client!.createdAt }) }}<span v-if="row.info.createdBy !== undefined">{{ ` ${t('access.by')} ` }}<bdi>{{ creatorName(row.info.createdBy) }}</bdi></span></span>
                                </p>
                                <p class="cps-access__muted cps-access__fingerprints">
                                    {{ t('access.fingerprints') }}
                                    <code
                                        v-for="(fp, i) in row.info.fingerprints"
                                        :key="i"
                                    >{{ fingerprintText(fp) }}</code>
                                </p>
                            </div>
                            <div class="cps-access__client-actions">
                                <RouterLink
                                    v-if="value"
                                    :to="`/settings/access/clients/${row.entry.client!.id}`"
                                    class="cps-btn cps-btn--ghost"
                                >
                                    {{ t('access.edit') }}
                                </RouterLink>
                                <button
                                    v-if="revision !== null"
                                    type="button"
                                    class="cps-btn cps-btn--danger"
                                    :disabled="busy"
                                    @click="remove(row)"
                                >
                                    {{ t('access.remove') }}
                                </button>
                            </div>
                        </li>
                    </ul>
                    <p class="cps-access__muted">
                        {{ t('access.creatorNote') }}
                    </p>
                    <div
                        v-if="value"
                        class="cps-form-actions"
                    >
                        <button
                            type="button"
                            class="cps-btn cps-btn--create"
                            @click="router.push('/settings/access/clients/new')"
                        >
                            {{ t('access.add') }}
                        </button>
                    </div>
                </section>

                <section
                    v-if="broken.length > 0"
                    class="cps-access__section cps-access__broken"
                >
                    <h2 class="cps-access__heading">
                        {{ t('access.brokenTitle') }}
                    </h2>
                    <p class="cps-access__muted">
                        {{ revision === null ? t('access.noRemove') : t('access.brokenIntro') }}
                    </p>
                    <ul class="cps-access__clients">
                        <li
                            v-for="row in broken"
                            :key="row.entry.index"
                            class="cps-access__client cps-access__broken-entry"
                        >
                            <div class="cps-access__client-text">
                                <p class="cps-access__broken-name">
                                    <template v-if="row.entry.id === undefined">
                                        {{ t('access.brokenEntry', { n: row.entry.index + 1 }) }}
                                    </template>
                                    <template v-else>
                                        {{ t('access.brokenEntryId', { n: row.entry.index + 1 }) }}<bdi>{{ shownId(row.entry.id) }}</bdi>
                                    </template>
                                </p>
                                <p v-if="row.info.name !== undefined">
                                    <bdi class="cps-access__broken-label">{{ row.info.name }}</bdi>
                                </p>
                                <p class="cps-access__muted">
                                    {{ permissionText(row.info) }}<template v-if="row.info.createdAt !== undefined">
                                        · <span class="cps-access__created"><template v-if="row.info.createdAtIsDate">{{ t('access.created', { date: row.info.createdAt }) }}</template><template v-else>{{ `${t('access.createdOn')} ` }}<bdi>{{ row.info.createdAt }}</bdi></template><span v-if="row.info.createdBy !== undefined">{{ ` ${t('access.by')} ` }}<bdi>{{ creatorName(row.info.createdBy) }}</bdi></span></span>
                                    </template>
                                </p>
                                <p
                                    v-if="row.info.fingerprints.length > 0"
                                    class="cps-access__muted cps-access__fingerprints"
                                >
                                    {{ t('access.fingerprints') }}
                                    <code
                                        v-for="(fp, i) in row.info.fingerprints"
                                        :key="i"
                                    >{{ fingerprintText(fp) }}</code>
                                </p>
                                <ul class="cps-access__reasons">
                                    <li
                                        v-for="reason in row.entry.reasons"
                                        :key="reason"
                                    >
                                        {{ t(`access.reasons.${reason}`) }}
                                    </li>
                                </ul>
                            </div>
                            <div
                                v-if="revision !== null"
                                class="cps-access__client-actions"
                            >
                                <button
                                    type="button"
                                    class="cps-btn cps-btn--danger"
                                    :disabled="busy"
                                    @click="remove(row)"
                                >
                                    {{ t('access.remove') }}
                                </button>
                            </div>
                        </li>
                    </ul>
                </section>
            </template>
        </template>
    </div>
</template>

<style scoped>
.cps-access__back {
    margin: 0 0 var(--cps-space-3);
    font-size: var(--cps-size-sm);
}
.cps-access {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
    margin-top: var(--cps-space-5);
}
.cps-access p {
    margin: 0;
}
.cps-access ul {
    margin: 0;
    padding: 0;
    list-style: none;
}
.cps-access__section {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-3);
}
.cps-access__heading {
    margin: 0;
    font-size: var(--cps-size);
    font-weight: var(--cps-weight-strong);
}
.cps-access__group,
.cps-access__client {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-1);
    padding: var(--cps-space-3) var(--cps-space-4);
    border: 1px solid var(--cps-divider);
    border-radius: var(--cps-radius);
    background: var(--cps-panel);
    overflow-wrap: anywhere;
}
.cps-access__clients {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-2);
}
.cps-access__role {
    font-weight: var(--cps-weight-strong);
}
.cps-access__group-error {
    color: var(--cps-danger);
}
.cps-access__group-actions,
.cps-access__client-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--cps-space-2);
}
.cps-access__client-name {
    font-weight: var(--cps-weight-strong);
    margin-right: var(--cps-space-2);
}
.cps-access__client-id {
    font-family: monospace;
    font-size: var(--cps-size-sm);
    color: var(--cps-text-muted);
}
.cps-access__muted {
    color: var(--cps-text-muted);
    font-size: var(--cps-size-sm);
}
.cps-access__fingerprints code {
    margin-left: var(--cps-space-1);
    font-family: monospace;
}
.cps-access__reasons {
    font-size: var(--cps-size-sm);
}
.cps-access__error {
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
.cps-access__error button {
    margin-left: var(--cps-space-2);
}
.cps-access__done {
    color: var(--cps-text-muted);
}
@media (min-width: 48rem) {
    .cps-access__client {
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
    }
}
</style>
