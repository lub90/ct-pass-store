<script setup lang="ts">
/**
 * „Texte“ (spec 4.6, 10.3): per language the title and explanation of „Mein Passwort“. An empty (or blank) field
 * means the default, shown below it. Custom texts are plain text everywhere: bound as input values and shown with
 * `{{ }}`, never as HTML and never as message syntax.
 *
 * Needs „edit custom data“ on `settings`; saves the whole value as read, so the rules, `backendUrl`, `oauthClientId`
 * and unknown fields stay as stored. An invalid stored value is repaired on „Passwortregeln“, not here: this page
 * doesn't show the rules it would have to write.
 */
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useServices } from '../../app/services';
import { useAppState } from '../../app/useAppState';
import { useSettingsForm } from '../../admin/useSettingsForm';
import { DEFAULT_TEXTS } from '../../i18n/custom-texts';
import { SUPPORTED, type Language } from '../../i18n/language';
import type { SettingsV2 } from '../../model/schemas';
import Field from '../../ui/Field.vue';
import { useConfirm } from '../../ui/useConfirm';
import SettingsFormPage from './SettingsFormPage.vue';

type Part = 'title' | 'intro';
/** Spec 4.6 / 6.1; the store checks the same limits (`.length`, as the schema does). */
const LIMITS: Record<Part, number> = { title: 60, intro: 300 };
const PARTS: Part[] = ['title', 'intro'];

const { t } = useI18n();
const services = useServices();
const app = useAppState();
const confirm = useConfirm();

const allowed = computed(() => app.settingsEditor.value.settings);

const form = useSettingsForm<SettingsV2>(
    () => services.store.readSettings(),
    (value, revision) => services.store.saveSettings(value, revision),
    {
        onSaved: () => app.reloadSettings(),
        confirm,
        leaveQuestion: () => ({ title: t('settings.leaveTitle'), text: t('settings.leaveText'), confirmLabel: t('settings.discard'), cancelLabel: t('settings.stay') }),
    },
);

watch(
    allowed,
    (ok) => {
        if (ok && form.status.value === 'idle') void form.load();
    },
    { immediate: true },
);

type Block = Record<string, unknown> & { title?: string; intro?: string };

function text(lang: Language, part: Part): string {
    const block = form.value.value?.texts?.[lang] as Block | undefined;
    const value = block?.[part];
    return typeof value === 'string' ? value : '';
}

/** A blank text removes the field; an empty language and empty texts disappear too. Other fields stay. */
function setText(lang: Language, part: Part, value: string): void {
    const settings = form.value.value;
    if (!settings) return;
    const texts: Record<string, unknown> = { ...(settings.texts ?? {}) };
    const block: Block = { ...((texts[lang] as Block | undefined) ?? {}) };
    if (value.trim() === '') delete block[part];
    else block[part] = value;
    if (Object.keys(block).length > 0) texts[lang] = block;
    else delete texts[lang];
    if (Object.keys(texts).length > 0) settings.texts = texts as SettingsV2['texts'];
    else delete settings.texts;
}

const tooLong = (lang: Language, part: Part): boolean => text(lang, part).length > LIMITS[part];
const valid = computed(() => SUPPORTED.every((lang) => PARTS.every((part) => !tooLong(lang, part))));
</script>

<template>
    <SettingsFormPage
        icon="text"
        :title="t('pages.texts')"
        :intro="t('settings.texts.intro')"
        :allowed="allowed"
        :missing-right="t('settings.missingRight', { right: 'edit custom data', category: 'settings' })"
        :form="form"
        :unrepairable="{ text: t('settings.repairOnRules'), to: '/settings/rules', linkText: t('pages.rules') }"
        :valid="valid"
    >
        <section
            v-for="lang in SUPPORTED"
            :key="lang"
            class="cps-texts__lang"
        >
            <h2>{{ t(`settings.texts.${lang}`) }}</h2>
            <div
                v-for="part in PARTS"
                :key="part"
                :data-text-field="`${lang}-${part}`"
            >
                <Field
                    :id="`cps-texts-${lang}-${part}`"
                    v-slot="{ id, describedby, invalid }"
                    :label="part === 'title' ? t('settings.texts.titleLabel') : t('settings.texts.introLabel')"
                    :error="tooLong(lang, part) ? t('settings.texts.tooLong', { max: LIMITS[part] }) : undefined"
                >
                    <input
                        v-if="part === 'title'"
                        :id="id"
                        type="text"
                        autocomplete="off"
                        :lang="lang"
                        :value="text(lang, part)"
                        :aria-describedby="[describedby, `${id}-meta`].filter(Boolean).join(' ')"
                        :aria-invalid="invalid"
                        @input="setText(lang, part, ($event.target as HTMLInputElement).value)"
                    >
                    <textarea
                        v-else
                        :id="id"
                        rows="3"
                        :lang="lang"
                        :value="text(lang, part)"
                        :aria-describedby="[describedby, `${id}-meta`].filter(Boolean).join(' ')"
                        :aria-invalid="invalid"
                        @input="setText(lang, part, ($event.target as HTMLTextAreaElement).value)"
                    />
                    <div
                        :id="`${id}-meta`"
                        class="cps-texts__meta"
                    >
                        <p
                            v-if="text(lang, part).trim() === ''"
                            class="cps-texts__default"
                            :lang="lang"
                        >
                            {{ t('settings.texts.defaultLabel') }} {{ DEFAULT_TEXTS[lang][part] }}
                        </p>
                        <span class="cps-texts__count">{{ `${text(lang, part).length}/${LIMITS[part]}` }}</span>
                    </div>
                </Field>
            </div>
        </section>
    </SettingsFormPage>
</template>

<style scoped>
.cps-texts__lang {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
}
.cps-texts__lang h2 {
    margin: 0;
    font-size: 1.15em;
}
.cps-texts__lang textarea {
    resize: vertical;
}
.cps-texts__meta {
    display: flex;
    gap: var(--cps-space-3);
    justify-content: space-between;
    font-size: var(--cps-size-sm);
    color: var(--cps-text-muted);
}
.cps-texts__default {
    margin: 0;
    min-width: 0;
}
.cps-texts__count {
    flex: none;
    margin-left: auto;
}
</style>
