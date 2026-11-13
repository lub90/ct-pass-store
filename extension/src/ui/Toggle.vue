<script setup lang="ts">
/**
 * An on/off switch: a native button with `role="switch"`, so Space and Enter work without extra code. The whole row is
 * a `<label>`: a click on the text activates the button, which gives the touch hit area. Whether a label click also moves focus is
 * browser-dependent; keyboard and focus behavior is covered by the browser tests.
 */
import { useId } from 'vue';

const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; help?: string }>();

const uid = useId();
</script>

<template>
    <label class="cps-toggle">
        <button
            type="button"
            role="switch"
            class="cps-toggle__switch"
            :aria-checked="model"
            :aria-labelledby="`${uid}-label`"
            :aria-describedby="help ? `${uid}-help` : undefined"
            @click="model = !model"
        >
            <span
                class="cps-toggle__knob"
                aria-hidden="true"
            />
        </button>
        <div class="cps-toggle__text">
            <span
                :id="`${uid}-label`"
                class="cps-toggle__label"
            >{{ label }}</span>
            <p
                v-if="help"
                :id="`${uid}-help`"
                class="cps-toggle__help"
            >
                {{ help }}
            </p>
        </div>
    </label>
</template>

<style scoped>
.cps-toggle {
    cursor: pointer;
    display: flex;
    align-items: flex-start;
    gap: var(--cps-space-3);
}
.cps-toggle__switch {
    flex: none;
    box-sizing: border-box;
    position: relative;
    width: 44px;
    height: 24px;
    margin: 0;
    padding: 0;
    border: 1px solid var(--cps-text-muted);
    border-radius: 999px;
    background: var(--cps-surface);
    cursor: pointer;
    transition:
        background-color var(--cps-transition),
        border-color var(--cps-transition);
}
.cps-toggle__switch[aria-checked='true'] {
    border-color: var(--cps-accent);
    background: var(--cps-accent);
}
.cps-toggle__knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--cps-text-muted);
    transition:
        transform var(--cps-transition),
        background-color var(--cps-transition);
}
.cps-toggle__switch[aria-checked='true'] .cps-toggle__knob {
    transform: translateX(20px);
    background: var(--cps-accent-text);
}
.cps-toggle__text {
    min-width: 0;
}

.cps-toggle__help {
    margin: 0;
    font-size: var(--cps-size-sm);
    color: var(--cps-text-muted);
}
@media (pointer: coarse) {
    /* The switch stays small to look right; the label row around it (text included) is the 44 px target. */
    .cps-toggle {
        min-height: 44px;
        align-items: center;
    }
}
</style>
