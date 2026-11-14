<script setup lang="ts">
/**
 * The frame of a settings page with a form (spec 4.4): header, back link, the page's own rights check, the states of
 * the read, what the stored value lacks (shown before any save), the form itself (slot) and the actions with
 * „Gespeichert“, the conflict and errors. Issues and right names are plain text.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { settingsErrorText, type SettingsForm } from '../../admin/useSettingsForm';
import Banner from '../../ui/Banner.vue';
import type { IconName } from '../../ui/Icon.vue';
import PageHeader from '../../ui/PageHeader.vue';
import StatusLine from '../../ui/StatusLine.vue';

const props = defineProps<{
    icon: IconName;
    title: string;
    intro: string;
    /** The page's own right; without it nothing is loaded and `missingRight` shows. */
    allowed: boolean;
    missingRight: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the frame doesn't touch the value's fields
    form: SettingsForm<any>;
    /** For an invalid value this page can't repair: what to say (plain text) and, optionally, where to go. */
    unrepairable: { text: string; to?: string; linkText?: string };
    /** The form's own checks pass (field errors block saving). */
    valid: boolean;
}>();

const { t } = useI18n();

const message = (error: unknown): string => {
    const { key, params } = settingsErrorText(error);
    return t(key, params);
};
const loadErrorText = computed(() => (props.form.loadError.value === null ? null : message(props.form.loadError.value)));
const saveErrorText = computed(() => (props.form.error.value === null ? null : message(props.form.error.value)));
const showSaved = computed(() => props.form.savedAt.value !== null && !props.form.dirty.value);
const invalidStored = computed(() => props.form.status.value === 'invalid' || props.form.repairing.value);
</script>

<template>
    <p class="cps-settings-form__back">
        <RouterLink to="/settings">
            {{ t('settings.back') }}
        </RouterLink>
    </p>
    <PageHeader
        :icon="icon"
        :title="title"
        :intro="intro"
    />
    <div class="cps-settings-form">
        <Banner
            v-if="!allowed"
            kind="warning"
        >
            <p>{{ missingRight }}</p>
        </Banner>
        <StatusLine
            v-else-if="form.status.value === 'idle' || form.status.value === 'loading'"
            kind="loading"
            :text="t('state.loading')"
        />
        <template v-else-if="form.status.value === 'error'">
            <StatusLine
                kind="error"
                :text="loadErrorText ?? ''"
            />
            <div class="cps-form-actions">
                <button
                    type="button"
                    class="cps-btn cps-btn--ghost"
                    @click="form.load()"
                >
                    {{ t('password.retry') }}
                </button>
            </div>
        </template>
        <StatusLine
            v-else-if="form.status.value === 'missing'"
            kind="empty"
            :text="t('settings.missing')"
        />
        <StatusLine
            v-else-if="form.status.value === 'newer'"
            kind="empty"
            :text="t('settings.newer')"
        />
        <template v-else>
            <Banner
                v-if="invalidStored || form.issues.value.length > 0"
                :kind="invalidStored ? 'error' : 'warning'"
                class="cps-settings-form__issues"
                :title="invalidStored ? t('settings.invalidTitle') : t('settings.issuesTitle')"
            >
                <ul>
                    <li
                        v-for="(issue, i) in form.issues.value"
                        :key="i"
                    >
                        {{ issue }}
                    </li>
                </ul>
                <p v-if="form.repairing.value">
                    {{ t('settings.repairNote') }}
                </p>
                <p v-else-if="invalidStored">
                    {{ unrepairable.text }}
                    <RouterLink
                        v-if="unrepairable.to"
                        :to="unrepairable.to"
                    >
                        {{ unrepairable.linkText }}
                    </RouterLink>
                </p>
                <p v-else>
                    {{ t('settings.issuesNote') }}
                </p>
            </Banner>
            <form
                v-if="form.value.value !== null"
                class="cps-settings-form__form"
                novalidate
                @submit.prevent="form.save()"
            >
                <slot />
                <p
                    v-if="form.conflict.value"
                    class="cps-settings-form__conflict"
                    role="alert"
                >
                    {{ t('settings.conflict') }}
                    <button
                        type="button"
                        class="cps-btn cps-btn--ghost"
                        @click="form.load()"
                    >
                        {{ t('settings.reload') }}
                    </button>
                </p>
                <p
                    v-if="saveErrorText"
                    class="cps-settings-form__error"
                    role="alert"
                >
                    {{ saveErrorText }}
                </p>
                <div class="cps-form-actions">
                    <button
                        type="submit"
                        class="cps-btn cps-btn--primary"
                        :disabled="!form.dirty.value || !valid || form.saving.value"
                    >
                        {{ t('common.save') }}
                    </button>
                    <button
                        type="button"
                        class="cps-btn cps-btn--ghost"
                        :disabled="!form.dirty.value || form.saving.value"
                        @click="form.discard()"
                    >
                        {{ t('settings.discard') }}
                    </button>
                    <span
                        v-if="form.saving.value"
                        class="cps-settings-form__saving"
                    >{{ t('settings.saving') }}</span>
                    <span
                        v-else-if="showSaved"
                        class="cps-settings-form__saved"
                        role="status"
                    >{{ t('settings.saved') }}</span>
                </div>
            </form>
        </template>
    </div>
</template>

<style scoped>
.cps-settings-form__back {
    margin: 0 0 var(--cps-space-3);
    font-size: var(--cps-size-sm);
}
.cps-settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
    margin-top: var(--cps-space-5);
}
.cps-settings-form p {
    margin: 0;
}
.cps-settings-form ul {
    margin: var(--cps-space-1) 0;
    padding-left: var(--cps-space-5);
    overflow-wrap: anywhere;
}
.cps-settings-form__form {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-5);
}
.cps-settings-form__conflict,
.cps-settings-form__error {
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
.cps-settings-form__conflict button {
    margin-left: var(--cps-space-2);
}
.cps-settings-form__saved,
.cps-settings-form__saving {
    color: var(--cps-text-muted);
    align-self: center;
}
</style>
