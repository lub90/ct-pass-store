import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import ChoiceCard from './ChoiceCard.vue';

const Group = defineComponent({
    components: { ChoiceCard },
    setup: () => ({ pick: ref('a') }),
    template: `<div role="radiogroup">
        <ChoiceCard v-model="pick" value="a" name="g" label="A" help="Help A" />
        <ChoiceCard v-model="pick" value="b" name="g" label="B" />
    </div>`,
});

describe('ChoiceCard', () => {
    // Real arrow-key behavior is proven in the browser tests (Task 19); here: structure and model wiring.
    it('renders native radios of one group so arrow keys work in browsers', () => {
        const w = mount(Group);
        const radios = w.findAll('input[type="radio"]');
        expect(radios.map((r) => r.attributes('name'))).toEqual(['g', 'g']);
        expect((radios[0]!.element as HTMLInputElement).checked).toBe(true);
        expect((radios[1]!.element as HTMLInputElement).checked).toBe(false);
    });

    it('selects on change and emits the value', async () => {
        const w = mount(Group);
        await w.findAll('input')[1]!.setValue(true);
        const radios = w.findAll('input');
        expect((radios[1]!.element as HTMLInputElement).checked).toBe(true);
        expect((radios[0]!.element as HTMLInputElement).checked).toBe(false);
        const single = mount(ChoiceCard, { props: { modelValue: 'a', value: 'b', name: 'g', label: 'B' } });
        await single.find('input').setValue(true);
        expect(single.emitted('update:modelValue')![0]).toEqual(['b']);
    });

    it('links help to the radio', () => {
        const w = mount(Group);
        const r = w.find('input');
        expect(w.find(`#${r.attributes('aria-describedby')}`).text()).toBe('Help A');
    });
});
