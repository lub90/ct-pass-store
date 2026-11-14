<script setup lang="ts">
/**
 * Several values in `settings` or `access` (spec 6.2, point B E1): none of them is used, by the extension or the
 * backend. Every value is shown with what decides where passwords go and who may read them (address with the real
 * host, OAuth client, rules; groups and the clients the backend would enable, with key fingerprints), and the fields
 * that differ are marked. The editor chooses which value stays; after a danger confirm naming the values to delete,
 * the store deletes the others only if the stored values are still exactly the ones shown (else a conflict, nothing
 * deleted). Every stored part is plain text, cut and isolated (`<bdi>`). Oldest value first; the newest (the one
 * most likely planted) is labelled „zuletzt angelegt“ (S2). The dialog names what keeping a value makes active where
 * the values differ (address and real host; groups and enabled clients, S1).
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { describeDuplicates, type ShownField, type ShownValue } from '../../admin/duplicates';
import { isolate } from '../../admin/machine-clients';
import { settingsErrorText } from '../../admin/useSettingsForm';
import { useServices } from '../../app/services';
import { ConflictError } from '../../model/errors';
import type { StoredValue } from '../../store/repository';
import Banner from '../../ui/Banner.vue';
import { useConfirm } from '../../ui/useConfirm';

const props = defineProps<{
    category: 'settings' | 'access';
    values: readonly StoredValue<unknown>[];
}>();
const emit = defineEmits<{ resolved: [valueId: number]; reload: [] }>();

const { t } = useI18n();
const services = useServices();
const confirm = useConfirm();

const shown = computed(() => describeDuplicates(props.category, props.values));
const busy = ref(false);
const conflict = ref(false);
const error = ref<string | null>(null);
let alive = true;
onBeforeUnmount(() => {
    alive = false;
});

const fieldLabel = (name: string): string => t(`duplicates.fields.${name.replace('.', '_')}`);
/** A field's value as shown: booleans as yes/no, everything else as its (cut) text. */
const fieldText = (field: ShownField): string => (field.bool === undefined ? field.text : t(field.bool ? 'duplicates.yes' : 'duplicates.no'));
const clientText = (c: NonNullable<ShownValue['clients']>[number]): string =>
    t('duplicates.confirmClient', {
        name: isolate(c.name),
        id: isolate(c.id),
        permission: c.canRead ? t('access.canRead') : t('access.canNothing'),
        keys: c.fingerprints.map((fp) => fp ?? t('access.keyInvalid')).join(', '),
    });

/**
 * What the dialog says about the kept value beyond its id (S1): where it sends passwords (address and real host) when
 * that differs between the values; for `access`, the differing groups and the clients it turns on.
 */
function keptDetails(value: ShownValue): string[] {
    const parts: string[] = [];
    for (const field of value.fields) {
        const hostDiffers = field.name === 'backendUrl' && shown.value.some((v) => v.fields.find((f) => f.name === 'backendUrl')?.host !== field.host);
        if (!field.differs && !hostDiffers) continue;
        // A kept address never has a host the browser rewrites (such a value can't be kept, S6): it is its real host.
        parts.push(t('duplicates.confirmField', { field: fieldLabel(field.name), value: field.isolate ? isolate(field.text) : fieldText(field) }));
    }
    if (value.clients && value.clientsDiffer) {
        parts.push(value.clients.length === 0 ? t('duplicates.confirmNoClients') : t('duplicates.confirmClients', { list: value.clients.map(clientText).join('; ') }));
    }
    return parts;
}
const stateText = (state: 'ok' | 'invalid' | 'newer', issues: number): string => (state === 'invalid' ? t('duplicates.states.invalid', { n: issues }) : t(`duplicates.states.${state}`));

async function keep(valueId: number): Promise<void> {
    if (busy.value) return;
    const values = props.values;
    const others = values.filter((v) => v.valueId !== valueId).map((v) => t('duplicates.value', { id: v.valueId }));
    const kept = shown.value.find((v) => v.valueId === valueId);
    busy.value = true;
    conflict.value = false;
    error.value = null;
    try {
        const answer = await confirm({
            title: t('duplicates.confirmTitle'),
            subject: { name: t('duplicates.value', { id: valueId }), detail: props.category },
            text: [...(kept ? keptDetails(kept) : []), t('duplicates.confirmText', { others: others.join(', ') })].join(' '),
            confirmLabel: t('duplicates.confirm'),
            cancelLabel: t('common.cancel'),
            danger: true,
        });
        // Left the page, or the list was read again meanwhile: nothing is sent.
        if (!answer.confirmed || !alive || props.values !== values) return;
        await services.store.resolveDuplicates(props.category, valueId, values);
    } catch (e) {
        if (!alive) return;
        if (e instanceof ConflictError) conflict.value = true;
        else {
            const { key, params } = settingsErrorText(e, props.category);
            error.value = t(key, params);
        }
        return;
    } finally {
        busy.value = false;
    }
    if (alive) emit('resolved', valueId);
}
</script>

<template>
    <div class="cps-duplicates">
        <Banner
            kind="error"
            :title="t('duplicates.title')"
        >
            <p>{{ t('duplicates.intro', { category, n: values.length }) }}</p>
            <p>{{ t('duplicates.warning') }}</p>
        </Banner>
        <p
            v-if="conflict"
            class="cps-duplicates__error"
            role="alert"
        >
            {{ t('duplicates.conflict') }}
            <button
                type="button"
                class="cps-btn cps-btn--ghost"
                @click="emit('reload')"
            >
                {{ t('settings.reload') }}
            </button>
        </p>
        <p
            v-else-if="error"
            class="cps-duplicates__error"
            role="alert"
        >
            {{ error }}
        </p>
        <ul class="cps-duplicates__values">
            <li
                v-for="value in shown"
                :key="value.valueId"
                class="cps-duplicates__value"
                :data-value-id="value.valueId"
            >
                <h2 class="cps-duplicates__heading">
                    {{ t('duplicates.value', { id: value.valueId }) }}
                    <span class="cps-duplicates__muted">· {{ stateText(value.state, value.issues) }}</span>
                    <span
                        v-if="value.newest"
                        class="cps-duplicates__newest"
                    >· {{ t('duplicates.newest') }}</span>
                </h2>
                <p class="cps-duplicates__muted cps-duplicates__revision">
                    {{ `${t('duplicates.revision')} ` }}<bdi v-if="value.revision.isolate">{{ value.revision.text }}</bdi><span v-else>{{ value.revision.text }}</span>
                </p>
                <dl class="cps-duplicates__fields">
                    <div
                        v-for="field in value.fields"
                        :key="field.name"
                        class="cps-duplicates__field"
                        :data-field="field.name"
                    >
                        <dt>{{ fieldLabel(field.name) }}</dt>
                        <dd>
                            <bdi v-if="field.isolate">{{ field.text }}</bdi><span v-else>{{ fieldText(field) }}</span>
                            <span
                                v-if="field.host"
                                class="cps-duplicates__host"
                            >{{ ` ${t('backend.realHost')} ` }}<bdi>{{ field.host }}</bdi></span>
                            <span
                                v-if="field.invisible"
                                class="cps-duplicates__flag"
                            >{{ ` · ${t('duplicates.invisible')}` }}</span>
                            <span
                                v-if="field.differs"
                                class="cps-duplicates__flag"
                            >{{ ` · ${t('duplicates.differs')}` }}</span>
                        </dd>
                    </div>
                </dl>
                <p
                    v-if="value.otherFields"
                    class="cps-duplicates__muted cps-duplicates__other"
                >
                    {{ `${t('duplicates.otherFields')} ` }}<bdi>{{ value.otherFields.text }}</bdi>
                </p>
                <template v-if="value.clients">
                    <p
                        v-if="value.clients.length === 0"
                        class="cps-duplicates__muted"
                    >
                        {{ t('duplicates.noClients') }}<span
                            v-if="value.clientsDiffer"
                            class="cps-duplicates__flag"
                        >{{ ` · ${t('duplicates.differs')}` }}</span>
                    </p>
                    <template v-else>
                        <p>
                            {{ t('duplicates.clients') }}<span
                                v-if="value.clientsDiffer"
                                class="cps-duplicates__flag"
                            >{{ ` · ${t('duplicates.differs')}` }}</span>
                        </p>
                        <ul class="cps-duplicates__clients">
                            <li
                                v-for="(client, i) in value.clients"
                                :key="i"
                                class="cps-duplicates__client"
                            >
                                <bdi class="cps-duplicates__client-name">{{ client.name }}</bdi>
                                {{ ' ' }}<span class="cps-duplicates__muted">{{ client.id }} · {{ client.canRead ? t('access.canRead') : t('access.canNothing') }} · {{ t('access.fingerprints') }}</span>
                                <code
                                    v-for="(fp, j) in client.fingerprints"
                                    :key="j"
                                >{{ fp ?? t('access.keyInvalid') }}</code>
                            </li>
                        </ul>
                    </template>
                    <p
                        v-if="value.disabledClients"
                        class="cps-duplicates__muted"
                    >
                        {{ t('duplicates.disabledClients', { n: value.disabledClients }) }}
                    </p>
                </template>
                <div class="cps-form-actions">
                    <button
                        v-if="value.keepable"
                        type="button"
                        class="cps-btn cps-btn--danger"
                        :disabled="busy"
                        @click="keep(value.valueId)"
                    >
                        {{ t('duplicates.keep') }}
                    </button>
                    <span
                        v-else
                        class="cps-duplicates__muted"
                    >{{ value.notKeepable === 'address' ? t('duplicates.notKeepableAddress') : t('duplicates.notKeepable') }}</span>
                </div>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.cps-duplicates {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
}
.cps-duplicates p {
    margin: 0;
}
.cps-duplicates ul {
    margin: 0;
    padding: 0;
    list-style: none;
}
.cps-duplicates__values {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-3);
}
.cps-duplicates__value {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-2);
    padding: var(--cps-space-3) var(--cps-space-4);
    border: 1px solid var(--cps-divider);
    border-radius: var(--cps-radius);
    background: var(--cps-panel);
    overflow-wrap: anywhere;
}
.cps-duplicates__heading {
    margin: 0;
    font-size: var(--cps-size);
    font-weight: var(--cps-weight-strong);
}
.cps-duplicates__fields {
    display: grid;
    gap: var(--cps-space-1);
    margin: 0;
}
.cps-duplicates__field {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cps-space-2);
}
.cps-duplicates__field dt {
    color: var(--cps-text-muted);
    min-width: 12rem;
}
.cps-duplicates__field dd {
    margin: 0;
}
.cps-duplicates__newest {
    font-weight: var(--cps-weight-strong);
    color: var(--cps-danger);
}
.cps-duplicates__flag {
    color: var(--cps-danger);
}
.cps-duplicates__muted {
    color: var(--cps-text-muted);
    font-size: var(--cps-size-sm);
}
.cps-duplicates__client-name {
    font-weight: var(--cps-weight-strong);
}
.cps-duplicates__client code {
    margin-left: var(--cps-space-1);
    font-family: monospace;
}
.cps-duplicates__error {
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
.cps-duplicates__error button {
    margin-left: var(--cps-space-2);
}
</style>
