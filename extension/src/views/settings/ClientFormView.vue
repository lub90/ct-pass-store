<script setup lang="ts">
/**
 * Adding (`/settings/access/clients/new`) or editing (`/settings/access/clients/:id`) a machine client (spec 4.7).
 * Needs „edit custom data“ on `access`; without it nothing is read.
 *
 * - The ID is proposed from the name until it is typed itself, and is fixed after creation (read-only when editing).
 * - Each public key is checked on the spot with the backend's rules (backend spec 3.2): canonical base64 or base64url
 *   of exactly 32 bytes, not twice in this client, not a key of another client. The whole list is checked like the
 *   backend reads it (`validateClients`), so the backend never disables a client saved here. Keys are never logged.
 * - A new client gets `createdAt` (today, the admin's local date) and `createdBy` (the logged-in ChurchTools person).
 *   Both are a note only: the client stays valid if that person leaves (spec 4.7).
 * - Saving uses the revision of the read (conflicts are reported, never overwritten); the store re-checks the list
 *   against stored entries it couldn't read and refuses a collision. Unknown fields of the client and of `access`
 *   stay as stored.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { parsePublicKey, slugFromName, todayIso, validateClients } from '../../admin/machine-clients';
import { useSettingsForm } from '../../admin/useSettingsForm';
import { useServices } from '../../app/services';
import { useAppState } from '../../app/useAppState';
import { CLIENT_ID_PATTERN, PERMISSION_READ_ENTRIES, phpTrim } from '../../model/machine-clients';
import type { AccessV2, MachineClient } from '../../model/schemas';
import Field from '../../ui/Field.vue';
import Toggle from '../../ui/Toggle.vue';
import { useConfirm } from '../../ui/useConfirm';
import SettingsFormPage from './SettingsFormPage.vue';

const { t } = useI18n();
const services = useServices();
const app = useAppState();
const route = useRoute();
const router = useRouter();
const confirm = useConfirm();

/** The edited client's id, fixed for the life of this page; `null`: a new client. */
const editId = typeof route.params.id === 'string' ? route.params.id : null;
const isNew = editId === null;

const allowed = computed(() => app.settingsEditor.value.access);
/** Raw ids of stored entries the backend can't use: a new client must not take one (the store would refuse it). */
const unusableIds = ref<string[]>([]);

function draft(): MachineClient {
    const by = app.personId.value;
    return { id: '', name: '', publicKeys: [''], permissions: [], createdAt: todayIso(new Date()), ...(by === null ? {} : { createdBy: by }) };
}

function indexIn(value: AccessV2): number {
    return isNew ? value.machineClients.length - 1 : value.machineClients.findIndex((c) => c.id === editId);
}

/** The edited client as it is stored: name and keys trimmed like the backend trims them. */
function finalize(value: AccessV2, index: number): AccessV2 {
    return {
        ...value,
        machineClients: value.machineClients.map((c, i) => (i === index ? { ...c, name: phpTrim(c.name), publicKeys: c.publicKeys.map(phpTrim) } : c)),
    };
}

const form = useSettingsForm<AccessV2>(
    async () => {
        const read = await services.store.readAccess();
        unusableIds.value = read.state === 'ok' ? (read.unusable ?? []).flatMap((u) => (u.id === undefined ? [] : [u.id])) : [];
        return read;
    },
    (value, revision) => services.store.saveAccess(finalize(value, indexIn(value)), revision),
    {
        prepare: isNew ? (stored) => ({ ...stored, machineClients: [...stored.machineClients, draft()] }) : undefined,
        onSaved: async () => {
            await router.push('/settings/access');
        },
        confirm,
        leaveQuestion: () => ({ title: t('settings.leaveTitle'), text: t('settings.leaveText'), confirmLabel: t('settings.discard'), cancelLabel: t('settings.stay') }),
    },
);

const index = computed(() => (form.value.value ? indexIn(form.value.value) : -1));
const current = computed<MachineClient | null>(() => (index.value >= 0 ? (form.value.value?.machineClients[index.value] ?? null) : null));
const others = computed(() => (form.value.value?.machineClients ?? []).filter((_, i) => i !== index.value));

watch(
    allowed,
    (ok) => {
        if (ok && form.status.value === 'idle') void form.load();
    },
    { immediate: true },
);

// Name and ID.
const nameTouched = ref(false);
const idTyped = ref(false);
function typeName(text: string): void {
    if (!current.value) return;
    nameTouched.value = true;
    current.value.name = text;
    if (isNew && !idTyped.value) current.value.id = slugFromName(text);
}
function typeId(text: string): void {
    if (!isNew || !current.value) return;
    idTyped.value = true;
    current.value.id = text;
}

const nameValid = computed(() => current.value !== null && phpTrim(current.value.name) !== '');
const nameError = computed(() => (nameTouched.value && !nameValid.value ? t('access.client.nameError') : undefined));
const idTaken = computed(() => {
    const id = current.value?.id ?? '';
    return isNew && (others.value.some((c) => c.id === id) || unusableIds.value.includes(id));
});
const idPatternOk = computed(() => CLIENT_ID_PATTERN.test(current.value?.id ?? ''));
const idError = computed(() => {
    if (!isNew || !current.value || current.value.id === '') return undefined;
    if (!idPatternOk.value) return t('access.client.idError');
    return idTaken.value ? t('access.client.idTaken') : undefined;
});

// Keys: compared as bytes (base64 and base64url of the same key are the same key).
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const otherKeys = computed(() => others.value.flatMap((c) => c.publicKeys.map(parsePublicKey).filter((k): k is Uint8Array => k !== null)));
const keyErrors = computed<(string | undefined)[]>(() => {
    const parsed = (current.value?.publicKeys ?? []).map((text) => ({ text, bytes: parsePublicKey(text) }));
    return parsed.map(({ text, bytes }, i) => {
        if (phpTrim(text) === '') return undefined;
        if (!bytes) return t('access.client.keyInvalid');
        if (parsed.slice(0, i).some((earlier) => earlier.bytes !== null && sameBytes(earlier.bytes, bytes))) return t('access.client.keyTwice');
        if (otherKeys.value.some((k) => sameBytes(k, bytes))) return t('access.client.keyTaken');
        return undefined;
    });
});
const keysValid = computed(() => {
    const keys = current.value?.publicKeys ?? [];
    return keys.length > 0 && keys.every((k) => phpTrim(k) !== '') && keyErrors.value.every((e) => e === undefined);
});
function setKey(i: number, text: string): void {
    if (current.value) current.value.publicKeys[i] = text;
}
function addKey(): void {
    current.value?.publicKeys.push('');
}
function removeKey(i: number): void {
    if (current.value && current.value.publicKeys.length > 1) current.value.publicKeys.splice(i, 1);
}

const canRead = computed({
    get: () => current.value?.permissions.includes(PERMISSION_READ_ENTRIES) ?? false,
    set: (on: boolean) => {
        if (current.value) current.value.permissions = on ? [PERMISSION_READ_ENTRIES] : [];
    },
});

/** The page's checks, then the backend's rules over the whole list as it would be stored. */
const valid = computed(() => {
    const value = form.value.value;
    if (!value || index.value < 0 || !nameValid.value || !keysValid.value) return false;
    if (isNew && (!idPatternOk.value || idTaken.value)) return false;
    return validateClients(finalize(value, index.value).machineClients).length === 0;
});

const unrepairable = computed(() => ({ text: app.setupCapable.value ? t('settings.noRepairVersion') : t('settings.noRepairAsk') }));
</script>

<template>
    <SettingsFormPage
        icon="shield"
        :title="t('pages.client')"
        :intro="isNew ? t('access.client.introNew') : t('access.client.introEdit')"
        :allowed="allowed"
        :missing-right="t('settings.missingRight', { right: 'edit custom data', category: 'access' })"
        :form="form"
        :unrepairable="unrepairable"
        :valid="valid"
        category="access"
        :blocked="current === null"
    >
        <template #blocked>
            <p class="cps-client__not-found">
                {{ t('access.client.notFound') }}
                <RouterLink to="/settings/access">
                    {{ t('pages.access') }}
                </RouterLink>
            </p>
        </template>
        <template v-if="current">
            <Field
                id="cps-client-name"
                v-slot="{ id, describedby, invalid }"
                :label="t('access.client.name')"
                :error="nameError"
            >
                <input
                    :id="id"
                    :value="current.name"
                    type="text"
                    autocomplete="off"
                    maxlength="200"
                    :aria-describedby="describedby"
                    :aria-invalid="invalid"
                    @input="typeName(($event.target as HTMLInputElement).value)"
                >
            </Field>
            <Field
                id="cps-client-id"
                v-slot="{ id, describedby, invalid }"
                :label="t('access.client.id')"
                :help="isNew ? t('access.client.idHelp') : t('access.client.idFixed')"
                :error="idError"
            >
                <input
                    :id="id"
                    :value="current.id"
                    class="cps-client__mono"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    maxlength="40"
                    :readonly="!isNew"
                    :aria-describedby="describedby"
                    :aria-invalid="invalid"
                    @input="typeId(($event.target as HTMLInputElement).value)"
                >
            </Field>
            <fieldset class="cps-client__keys">
                <legend class="cps-client__legend">
                    {{ t('access.client.keysTitle') }}
                </legend>
                <p class="cps-client__help">
                    {{ t('access.client.keysHelp') }}
                </p>
                <div
                    v-for="(text, i) in current.publicKeys"
                    :key="i"
                    class="cps-client__key"
                >
                    <Field
                        :id="`cps-client-key-${i}`"
                        v-slot="{ id, describedby, invalid }"
                        :label="t('access.client.key', { n: i + 1 })"
                        :error="keyErrors[i]"
                    >
                        <input
                            :id="id"
                            :value="text"
                            class="cps-client__mono"
                            type="text"
                            autocomplete="off"
                            spellcheck="false"
                            maxlength="200"
                            :aria-describedby="describedby"
                            :aria-invalid="invalid"
                            @input="setKey(i, ($event.target as HTMLInputElement).value)"
                        >
                    </Field>
                    <button
                        v-if="current.publicKeys.length > 1"
                        type="button"
                        class="cps-btn cps-btn--ghost"
                        :aria-label="t('access.client.removeKey', { n: i + 1 })"
                        @click="removeKey(i)"
                    >
                        {{ t('access.remove') }}
                    </button>
                </div>
                <div>
                    <button
                        type="button"
                        class="cps-btn cps-btn--ghost"
                        @click="addKey()"
                    >
                        {{ t('access.client.addKey') }}
                    </button>
                </div>
            </fieldset>
            <Toggle
                v-model="canRead"
                :label="t('access.client.permission')"
                :help="t('access.client.permissionHelp')"
            />
        </template>
    </SettingsFormPage>
</template>

<style scoped>
.cps-client__keys {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-3);
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
}
.cps-client__legend {
    padding: 0;
    font-weight: var(--cps-weight-strong);
}
.cps-client__help {
    margin: 0;
    color: var(--cps-text-muted);
    font-size: var(--cps-size-sm);
}
.cps-client__key {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--cps-space-2);
}
.cps-client__key > :first-child {
    flex: 1 1 20rem;
    min-width: 0;
}
.cps-client__mono {
    font-family: monospace;
}
.cps-client__not-found {
    margin: 0;
}
</style>
