import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Toggle from './Toggle.vue';

describe('Toggle', () => {
    it('is a switch that mirrors the model', async () => {
        const w = mount(Toggle, { props: { modelValue: false, label: 'Enable', 'onUpdate:modelValue': (v: boolean) => w.setProps({ modelValue: v }) } });
        const sw = w.find('[role="switch"]');
        expect(sw.attributes('aria-checked')).toBe('false');
        await sw.trigger('click');
        expect(sw.attributes('aria-checked')).toBe('true');
        await sw.trigger('click');
        expect(sw.attributes('aria-checked')).toBe('false');
    });

    it('is a native button, so Space and Enter activate it', () => {
        const w = mount(Toggle, { props: { modelValue: false, label: 'Enable' } });
        expect(w.find('[role="switch"]').element.tagName).toBe('BUTTON');
        expect(w.find('[role="switch"]').attributes('type')).toBe('button');
    });

    it('names the switch by its label and links help', () => {
        const w = mount(Toggle, { props: { modelValue: true, label: 'Enable', help: 'Why' } });
        const sw = w.find('[role="switch"]');
        expect(w.text()).toContain('Enable');
        expect(w.find(`#${sw.attributes('aria-describedby')}`).text()).toBe('Why');
        expect(sw.attributes('aria-labelledby')).toBeTruthy();
    });
});
