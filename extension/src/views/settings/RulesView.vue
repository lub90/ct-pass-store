<script setup lang="ts">
/**
 * „Passwortregeln“ (spec 4.5). Needs „edit custom data“ on `settings` (spec 3.1, 8.1); without it nothing is read.
 * Saves the whole value as read, so `backendUrl`, `oauthClientId`, the texts and unknown fields stay as stored (E15:
 * this page never writes the backend address). An invalid stored value is rebuilt by `settingsRepair` (valid fields
 * kept, safe rules), but only when `backendUrl` and `oauthClientId` are absent or valid.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useServices } from '../../app/services';
import { useAppState } from '../../app/useAppState';
import { settingsRepair } from '../../admin/settings-repair';
import { useSettingsForm } from '../../admin/useSettingsForm';
import { PASSWORD_LENGTH, type SettingsV2 } from '../../model/schemas';
import Field from '../../ui/Field.vue';
import Toggle from '../../ui/Toggle.vue';
import { useConfirm } from '../../ui/useConfirm';
import SettingsFormPage from './SettingsFormPage.vue';

const { min: MIN_LENGTH, max: MAX_LENGTH } = PASSWORD_LENGTH;

const { t } = useI18n();
const services = useServices();
const app = useAppState();
const confirm = useConfirm();

const allowed = computed(() => app.settingsEditor.value.settings);

const form = useSettingsForm<SettingsV2>(
    () => services.store.readSettings(),
    (value, revision) => services.store.saveSettings(value, revision),
    {
        repair: (read) => {
            const r = settingsRepair(read);
            return 'value' in r ? r.value : null;
        },
        onSaved: () => app.reloadSettings(),
        confirm,
        leaveQuestion: () => ({ title: t('settings.leaveTitle'), text: t('settings.leaveText'), confirmLabel: t('settings.discard'), cancelLabel: t('settings.stay') }),
    },
);

/** Why the stored value can't be repaired here: version (or revision) vs. backend address / OAuth client. */
const unrepairable = computed(() => {
    const read = form.invalidRead.value;
    const r = read ? settingsRepair(read) : null;
    return { text: r && 'reason' in r && r.reason === 'backend' ? t('settings.noRepair') : t('settings.noRepairVersion') };
});

watch(
    allowed,
    (ok) => {
        if (ok && form.status.value === 'idle') void form.load();
    },
    { immediate: true },
);

const lengthValid = computed(() => {
    const n = form.value.value?.passwordLength;
    return typeof n === 'number' && Number.isInteger(n) && n >= MIN_LENGTH && n <= MAX_LENGTH;
});
/** Anything but plain digits is no length (NaN stays invalid and counts as a change). */
const parseLength = (text: string): number => (/^[0-9]+$/.test(text.trim()) ? Number(text.trim()) : NaN);

/** What is typed; the value follows it, and it follows the value when that changes elsewhere (load, discard). */
const lengthInput = ref('');
watch(lengthInput, (text) => {
    if (form.value.value) form.value.value.passwordLength = parseLength(text);
});
watch(
    () => form.value.value?.passwordLength,
    (n) => {
        if (typeof n === 'number' && Number.isFinite(n) && parseLength(lengthInput.value) !== n) lengthInput.value = String(n);
    },
    { immediate: true },
);
</script>

<template>
    <SettingsFormPage
        icon="lock"
        :title="t('pages.rules')"
        :intro="t('settings.rules.intro')"
        :allowed="allowed"
        :missing-right="t('settings.missingRight', { right: 'edit custom data', category: 'settings' })"
        :form="form"
        :unrepairable="unrepairable"
        :valid="lengthValid"
    >
        <template v-if="form.value.value">
            <Toggle
                v-model="form.value.value.requirePasswordForPasswordChange"
                :label="t('settings.rules.requirePrimary')"
                :help="t('settings.rules.requirePrimaryHelp')"
            />
            <Toggle
                v-model="form.value.value.allowCustomPassword"
                :label="t('settings.rules.allowCustom')"
                :help="t('settings.rules.allowCustomHelp')"
            />
            <Field
                id="cps-rules-length"
                v-slot="{ id, describedby, invalid }"
                :label="t('settings.rules.length')"
                :help="t('settings.rules.lengthHelp')"
                :error="lengthValid ? undefined : t('settings.rules.lengthError', { min: MIN_LENGTH, max: MAX_LENGTH })"
            >
                <input
                    :id="id"
                    v-model="lengthInput"
                    class="cps-rules__length"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    :aria-describedby="describedby"
                    :aria-invalid="invalid"
                >
            </Field>
        </template>
    </SettingsFormPage>
</template>

<style scoped>
.cps-rules__length {
    max-width: 8rem;
}
</style>
