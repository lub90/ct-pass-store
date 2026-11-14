<script setup lang="ts">
/**
 * States 2 and 3 of „Mein Passwort“ (spec 4.2), also used by „Passwörter verwalten“ (4.3). Mounted when the person
 * asks for a new password; without anything to choose or confirm it sends right away (the direct path).
 *
 * Plaintext (typed or generated) lives only in this component's refs: never in storage, the address or a log. It is
 * dropped on „Fertig“, „Abbrechen“, after saving and when the component unmounts (leaving the page); a password that
 * arrives after the unmount is not kept. While any is on screen the session counts it as unsaved input, so a token
 * problem asks for a renewal instead of reloading the page. The status of the entry is not this component's business:
 * every change is announced through `usePasswordEntry`, and the page reads the status again.
 *
 * For someone else (`forName`, spec 4.3) a warning banner names the person above the flow, and if they have a password
 * a confirm dialog naming them comes before anything is sent. The name is plain text: a named parameter or `{{ }}`,
 * never part of a message.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { isSettingsEditor } from '../app/app-state';
import { useAppState } from '../app/useAppState';
import { useSession } from '../app/useSession';
import { PopupBlocked, PopupClosed } from '../backend/auth';
import { BackendProblem, BackendUnreachable, UnexpectedResponse, problemMessageKey, problemParams } from '../backend/problems';
import Banner from '../ui/Banner.vue';
import ChoiceCard from '../ui/ChoiceCard.vue';
import Pill from '../ui/Pill.vue';
import SecretField from '../ui/SecretField.vue';
import StatusLine from '../ui/StatusLine.vue';
import { useConfirm } from '../ui/useConfirm';
import { canSubmit, nextAfterOverview, type FlowSettings, type FlowState } from './flow';
import { MAX_LENGTH, SYMBOLS, checkPassword, type Rule } from './rules';
import { usePasswordEntry } from './usePasswordEntry';

const props = defineProps<{
    personId: number;
    /** The person's name when an admin acts for someone else (spec 4.3): warning banner and confirm dialog. */
    forName?: string;
    settings: FlowSettings;
    hasEntry: boolean;
}>();
const emit = defineEmits<{
    /** Back to state 1: `saved` after a chosen password, `generated` after „Fertig“. */
    done: [outcome: 'cancelled' | 'saved' | 'generated'];
}>();

const { t } = useI18n();
const session = useSession();
const app = useAppState();
const confirm = useConfirm();
const entry = usePasswordEntry(() => props.personId, { load: false });

type RuleKey = 'length' | 'letter' | 'digit' | 'symbol' | 'chars';
const RULES: { key: RuleKey; codes: Rule[] }[] = [
    { key: 'length', codes: ['too-short', 'too-long'] },
    { key: 'letter', codes: ['missing-letter'] },
    { key: 'digit', codes: ['missing-digit'] },
    { key: 'symbol', codes: ['missing-symbol'] },
    { key: 'chars', codes: ['invalid-character'] },
];
/** Not "not yet" but wrong: more typing can't fix these. */
const WRONG: readonly Rule[] = ['too-long', 'invalid-character'];
const SESSION_SLUGS = new Set(['token-expired', 'invalid-token', 'missing-token']);

const state = ref<FlowState>({ step: 'choose', mode: 'generate' });
const password = ref('');
const primary = ref('');
const busy = ref(false);
/** Above the button. `detail`: plain text, admins and settings editors only. */
const error = ref<{ text: string; detail?: string } | null>(null);
const primaryError = ref('');
/** Rules the backend reported (`password-invalid`) for the password as sent. */
const serverViolations = ref<Rule[]>([]);
const unknownOutcome = ref(false);
const copyFailed = ref(false);
/** Whether the custom password is visible; disallowed characters are only echoed then. */
const customShown = ref(false);
let alive = true;

const requirePrimary = computed(() => props.settings.requirePasswordForPasswordChange);
const mode = computed(() => (state.value.step === 'choose' ? state.value.mode : 'generate'));
const choice = computed({
    get: () => mode.value,
    set: (value: string) => {
        state.value = { step: 'choose', mode: value === 'custom' ? 'custom' : 'generate' };
    },
});
/** Nothing to choose or confirm: generated right away; only a failure shows the form (to retry). */
const direct = computed(() => nextAfterOverview(props.settings) === 'generate-now');
const generated = computed(() => (state.value.step === 'result' ? (state.value.generated ?? '') : ''));
const detailed = computed(() => session.admin.value || isSettingsEditor(app.settingsEditor.value));

const check = computed(() =>
    state.value.step === 'choose' ? canSubmit(state.value, { password: password.value, primaryPassword: primary.value }, props.settings) : { ok: false },
);

const violations = computed(() => checkPassword(password.value, props.settings.passwordLength));
const rules = computed(() =>
    RULES.map(({ key, codes }) => {
        const local = violations.value.filter((c) => codes.includes(c));
        const failed = serverViolations.value.some((c) => codes.includes(c)) || local.some((c) => WRONG.includes(c));
        return { key, state: failed ? 'failed' : local.length > 0 ? 'open' : 'ok' };
    }),
);
const ruleText = (key: RuleKey): string =>
    key === 'length'
        ? t('password.rules.length', { n: props.settings.passwordLength, max: MAX_LENGTH })
        : key === 'symbol'
          ? t('password.rules.symbol', { symbols: SYMBOLS.split('').join(' ') })
          : t(`password.rules.${key}`);

const codePoint = (c: string): string => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * The characters the rules don't allow, named so that a pasted space or line break is visible. While the field is
 * masked only their kinds are named (the password is not echoed); while it is shown each one is, and invisible ones
 * (controls, format and zero-width characters, other spaces, combining marks) as U+XXXX. Line breaks never get here:
 * text and password inputs drop them.
 */
const notAllowed = computed(() => {
    const bad = [...new Set(Array.from(password.value))].filter((c) => !/^[A-Za-z0-9]$/.test(c) && !SYMBOLS.includes(c));
    if (customShown.value) {
        return bad
            .map((c) => {
                if (c === ' ') return t('password.rules.space');
                if (c === '\t') return t('password.rules.tab');
                if (/[\p{C}\p{Z}\p{M}]/u.test(c)) return codePoint(c);
                return `„${c}“`;
            })
            .join(', ');
    }
    const kinds = new Set<string>();
    for (const c of bad) {
        if (c === ' ') kinds.add('space');
        else if (/\p{Cc}/u.test(c)) kinds.add('control');
        else if (c.codePointAt(0)! > 0x7f) kinds.add('nonAscii');
        else kinds.add('otherSymbol');
    }
    return ['space', 'control', 'nonAscii', 'otherSymbol']
        .filter((k) => kinds.has(k))
        .map((k) => t(`password.rules.${k}`))
        .join(', ');
});

// A new input invalidates what the backend said about the old one.
watch(password, () => (serverViolations.value = []));
watch(primary, () => (primaryError.value = ''));
// Custom passwords switched off (settings reloaded): back to generating, the typed one is dropped.
watch(
    () => props.settings.allowCustomPassword,
    (allowed) => {
        if (!allowed && mode.value === 'custom') {
            password.value = '';
            state.value = { step: 'choose', mode: 'generate' };
        }
    },
);

function clearInput(): void {
    password.value = '';
    primary.value = '';
}

function showProblem(e: unknown): void {
    error.value = { text: t(problemMessageKey(e), problemParams(e)) };
    if (detailed.value && e instanceof BackendProblem && e.detail) error.value.detail = e.detail;
}

/** `sent`: the request may have reached the backend, so a lost answer leaves the outcome open. */
async function fail(e: unknown, sent: boolean): Promise<void> {
    // The session shows „Sitzung erneuern“ or logs in again; what was typed stays.
    if (e instanceof PopupBlocked || e instanceof PopupClosed) return;
    if (e instanceof BackendProblem && SESSION_SLUGS.has(e.slug)) {
        // With the banner up the person renews there; otherwise (e.g. token-expired again right after a renewal)
        // say so instead of nothing.
        if (session.needsRenewal.value) return;
        return showProblem(e);
    }
    if (sent && (e instanceof BackendUnreachable || e instanceof UnexpectedResponse)) {
        // The status is read again by the page (every change is announced).
        unknownOutcome.value = true;
        return;
    }
    if (!(e instanceof BackendProblem)) return showProblem(e);
    switch (e.slug) {
        case 'primary-password-required':
        case 'invalid-primary-password':
            primaryError.value = t(problemMessageKey(e));
            return;
        case 'password-invalid':
            serverViolations.value = (e.violations ?? []) as Rule[];
            return showProblem(e);
        case 'custom-password-not-allowed':
            showProblem(e);
            await app.reloadSettings();
            return;
        default:
            return showProblem(e);
    }
}

/** Spec 4.3: replacing someone else's password needs a yes first. */
async function confirmed(): Promise<boolean> {
    if (props.forName === undefined || !props.hasEntry) return true;
    const answer = await confirm({
        title: t('manage.replaceTitle'),
        text: t('manage.replaceText', { name: props.forName }),
        confirmLabel: t('manage.replaceConfirm'),
        cancelLabel: t('common.cancel'),
    });
    return answer.confirmed;
}

async function submit(): Promise<void> {
    if (busy.value || state.value.step !== 'choose' || !check.value.ok) return;
    busy.value = true;
    error.value = null;
    primaryError.value = '';
    unknownOutcome.value = false;
    const primaryPwd = requirePrimary.value ? primary.value : undefined;
    try {
        // Inside the click handler, before anything else is awaited: a popup needs the click (spec 7.2).
        await session.ensureFresh();
    } catch (e) {
        busy.value = false;
        await fail(e, false);
        return;
    }
    if (!(await confirmed())) {
        busy.value = false;
        // The direct path has no form to go back to.
        if (alive && direct.value) emit('done', 'cancelled');
        return;
    }
    // Left while the dialog was open: nothing is sent for a page nobody sees.
    if (!alive) return;
    try {
        if (mode.value === 'generate') {
            const plaintext = await entry.generate(primaryPwd);
            // Left meanwhile: nobody can see it any more, so it is not kept.
            if (!alive) return;
            clearInput();
            state.value = { step: 'result', generated: plaintext };
        } else {
            await entry.setCustom(password.value, primaryPwd);
            clearInput();
            emit('done', 'saved');
        }
    } catch (e) {
        if (alive) await fail(e, true);
    } finally {
        busy.value = false;
    }
}

function cancel(): void {
    clearInput();
    emit('done', 'cancelled');
}

function finish(): void {
    state.value = { step: 'choose', mode: 'generate' };
    emit('done', 'generated');
}

let untrack = (): void => undefined;
onMounted(() => {
    untrack = session.trackUnsaved(() => password.value !== '' || primary.value !== '' || state.value.step === 'result');
    if (direct.value) void submit();
});
onBeforeUnmount(() => {
    alive = false;
    untrack();
    clearInput();
    state.value = { step: 'choose', mode: 'generate' };
});
</script>

<template>
    <Banner
        v-if="forName !== undefined"
        kind="warning"
        class="cps-flow-for"
    >
        <I18nT
            keypath="manage.forName"
            tag="p"
        >
            <template #name>
                <strong>{{ forName }}</strong>
            </template>
        </I18nT>
    </Banner>
    <section
        v-if="state.step === 'result'"
        class="cps-flow cps-flow__result"
    >
        <p>
            <Pill kind="ok">
                {{ t('password.saved') }}
            </Pill>
        </p>
        <SecretField
            :label="t('password.resultLabel')"
            :value="generated"
            readonly
            autocomplete="off"
            revealed
            mono
            :reveal-label="t('password.reveal')"
            :hide-label="t('password.hide')"
            :copy-label="t('password.copy')"
            :copied-label="t('password.copied')"
            :error="copyFailed ? t('password.copyFailed') : undefined"
            @copy-failed="copyFailed = true"
        />
        <Banner kind="warning">
            <p>{{ t('password.onlyNow') }}</p>
        </Banner>
        <div class="cps-form-actions">
            <button
                type="button"
                class="cps-btn cps-btn--primary"
                @click="finish"
            >
                {{ t('password.done') }}
            </button>
        </div>
    </section>

    <section
        v-else-if="direct && busy"
        class="cps-flow"
    >
        <StatusLine
            kind="loading"
            :text="t('password.generating')"
        />
    </section>

    <form
        v-else
        class="cps-flow"
        novalidate
        @submit.prevent="submit"
    >
        <fieldset
            v-if="settings.allowCustomPassword"
            class="cps-flow__choice"
        >
            <legend>{{ t('password.choiceLabel') }}</legend>
            <ChoiceCard
                v-model="choice"
                name="cps-password-mode"
                value="generate"
                :label="t('password.generate')"
                :help="t('password.generateHelp')"
            />
            <ChoiceCard
                v-model="choice"
                name="cps-password-mode"
                value="custom"
                :label="t('password.custom')"
            />
        </fieldset>

        <template v-if="mode === 'custom'">
            <SecretField
                v-model="password"
                v-model:revealed="customShown"
                :label="t('password.customLabel')"
                autocomplete="new-password"
                :reveal-label="t('password.reveal')"
                :hide-label="t('password.hide')"
                :aria-describedby="'cps-flow-rules'"
            />
            <ul
                id="cps-flow-rules"
                class="cps-rules"
                :aria-label="t('password.rules.label')"
                aria-live="polite"
            >
                <li
                    v-for="rule in rules"
                    :key="rule.key"
                    :data-rule="rule.key"
                    :data-state="rule.state"
                    :class="`cps-rules__item--${rule.state}`"
                >
                    <span
                        class="cps-rules__mark"
                        aria-hidden="true"
                    >{{ rule.state === 'ok' ? '✓' : rule.state === 'failed' ? '✗' : '○' }}</span>
                    <span>{{ ruleText(rule.key) }}</span>
                    <span class="cps-rules__state">{{ t(`password.rules.${rule.state}`) }}</span>
                    <span
                        v-if="rule.key === 'chars' && notAllowed"
                        class="cps-rules__named"
                    >{{ t('password.rules.notAllowed') }} {{ notAllowed }}</span>
                </li>
            </ul>
        </template>

        <SecretField
            v-if="requirePrimary"
            v-model="primary"
            :label="t('password.primaryLabel')"
            autocomplete="current-password"
            :reveal-label="t('password.reveal')"
            :hide-label="t('password.hide')"
            :error="primaryError || undefined"
        />

        <Banner
            v-if="unknownOutcome"
            kind="warning"
        >
            <p>{{ t('password.unknownOutcome') }}</p>
        </Banner>
        <div
            v-if="error"
            class="cps-flow__error"
            role="alert"
        >
            <p>{{ error.text }}</p>
            <details v-if="error.detail">
                <summary>{{ t('state.details') }}</summary>
                <p>{{ error.detail }}</p>
            </details>
        </div>

        <div class="cps-form-actions">
            <button
                type="submit"
                class="cps-btn cps-btn--primary"
                :disabled="!check.ok || busy"
                :aria-describedby="check.reason ? 'cps-flow-hint' : undefined"
            >
                {{ mode === 'custom' ? t('password.submitCustom') : t('password.submitGenerate') }}
            </button>
            <button
                type="button"
                class="cps-btn cps-btn--ghost"
                :disabled="busy"
                @click="cancel"
            >
                {{ t('common.cancel') }}
            </button>
        </div>
        <p
            v-if="check.reason"
            id="cps-flow-hint"
            class="cps-flow__hint"
        >
            {{ t(check.reason) }}
        </p>
    </form>
</template>

<style scoped>
.cps-flow-for {
    margin-bottom: var(--cps-space-4);
}
.cps-flow-for p {
    margin: 0;
}
.cps-flow {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-4);
}
.cps-flow p {
    margin: 0;
}
.cps-flow__choice {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-2);
    margin: 0;
    padding: 0;
    border: 0;
}
.cps-flow__choice legend {
    margin-bottom: var(--cps-space-2);
    font-weight: var(--cps-weight-strong);
}
.cps-rules {
    display: flex;
    flex-direction: column;
    gap: var(--cps-space-1);
    margin: calc(-1 * var(--cps-space-2)) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--cps-size-sm);
}
.cps-rules li {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--cps-space-2);
    color: var(--cps-text-muted);
}
.cps-rules__item--ok {
    color: var(--cps-text);
}
.cps-rules__item--failed {
    color: var(--cps-text);
}
.cps-rules__item--ok .cps-rules__mark {
    color: var(--cps-success);
}
.cps-rules__item--failed .cps-rules__mark {
    color: var(--cps-danger);
}
.cps-rules__named {
    flex-basis: 100%;
    padding-left: var(--cps-space-4);
}
.cps-rules__state {
    /* For screen readers: the mark is only drawn. */
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.cps-flow__error {
    padding-left: var(--cps-space-2);
    border-left: 3px solid var(--cps-danger);
}
.cps-flow__hint {
    color: var(--cps-text-muted);
    font-size: var(--cps-size-sm);
}
</style>
