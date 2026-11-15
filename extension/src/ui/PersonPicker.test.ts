import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonPicker from './PersonPicker.vue';

const people = [
    { id: 1, name: 'Anna Beck', detail: 'anna@example.org' },
    { id: 2, name: 'Anton Rau' },
];
const props = { label: 'Person', placeholder: 'Search', emptyText: 'Nobody found', errorText: 'Search failed' };

async function type(w: ReturnType<typeof mount>, text: string) {
    const input = w.find('input');
    await input.setValue(text);
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
}

describe('PersonPicker', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('debounces: fast typing makes one search call with the last text', async () => {
        const search = vi.fn().mockResolvedValue(people);
        const w = mount(PersonPicker, { props: { ...props, search } });
        const input = w.find('input');
        await input.setValue('A');
        await vi.advanceTimersByTimeAsync(100);
        await input.setValue('An');
        await vi.advanceTimersByTimeAsync(100);
        await input.setValue('Ann');
        expect(search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(250);
        await flushPromises();
        expect(search).toHaveBeenCalledTimes(1);
        expect(search).toHaveBeenCalledWith('Ann');
    });

    it('is a combobox with a listbox of options', async () => {
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue(people) } });
        const input = w.find('input');
        expect(input.attributes('role')).toBe('combobox');
        expect(input.attributes('aria-expanded')).toBe('false');
        await type(w, 'An');
        expect(input.attributes('aria-expanded')).toBe('true');
        const options = w.findAll('[role="option"]');
        expect(options).toHaveLength(2);
        expect(w.find('[role="listbox"]').exists()).toBe(true);
        expect(options[0]!.text()).toContain('Anna Beck');
        expect(options[0]!.text()).toContain('anna@example.org');
    });

    it('an option reads „name, detail“: the detail below the name, a hidden comma between them', async () => {
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue(people) } });
        await type(w, 'a');
        const option = w.findAll('[role="option"]')[0]!;
        expect(option.find('.cps-picker__detail').text()).toBe('anna@example.org');
        expect(option.element.textContent).toBe('Anna Beck, anna@example.org');
    });

    it('isolates names and details (<bdi>), so a right-to-left override in a name cannot reorder the line', async () => {
        const name = 'Eva \u202Enamffoh';
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue([{ id: 9, name, detail: 'ID 9' }]) } });
        await type(w, 'e');
        const option = w.findAll('[role="option"]')[0]!;
        expect(option.find('bdi.cps-picker__name').text()).toBe(name);
        expect(option.find('bdi.cps-picker__detail').text()).toBe('ID 9');
    });

    it('Down/Up move aria-activedescendant, Enter selects', async () => {
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue(people) } });
        await type(w, 'An');
        const input = w.find('input');
        const options = w.findAll('[role="option"]');
        await input.trigger('keydown', { key: 'ArrowDown' });
        expect(input.attributes('aria-activedescendant')).toBe(options[0]!.attributes('id'));
        await input.trigger('keydown', { key: 'ArrowDown' });
        expect(input.attributes('aria-activedescendant')).toBe(options[1]!.attributes('id'));
        expect(options[1]!.attributes('aria-selected')).toBe('true');
        await input.trigger('keydown', { key: 'ArrowDown' });
        expect(input.attributes('aria-activedescendant')).toBe(options[0]!.attributes('id'));
        await input.trigger('keydown', { key: 'ArrowUp' });
        expect(input.attributes('aria-activedescendant')).toBe(options[1]!.attributes('id'));
        await input.trigger('keydown', { key: 'Enter' });
        expect(w.emitted('update:selected')![0]).toEqual([people[1]]);
        expect(w.find('[role="listbox"]').exists()).toBe(false);
        expect((input.element as HTMLInputElement).value).toBe('Anton Rau');
    });

    it('a click selects', async () => {
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue(people) } });
        await type(w, 'An');
        await w.findAll('[role="option"]')[0]!.trigger('click');
        expect(w.emitted('update:selected')![0]).toEqual([people[0]]);
    });

    it('Escape closes the list without selecting', async () => {
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue(people) } });
        await type(w, 'An');
        await w.find('input').trigger('keydown', { key: 'Escape' });
        expect(w.find('[role="listbox"]').exists()).toBe(false);
        expect(w.emitted('update:selected')).toBeUndefined();
    });

    it('Enter without an active option selects nothing', async () => {
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue(people) } });
        await type(w, 'An');
        await w.find('input').trigger('keydown', { key: 'Enter' });
        expect(w.emitted('update:selected')).toBeUndefined();
    });

    it('shows the empty text when nothing matches', async () => {
        const w = mount(PersonPicker, { props: { ...props, search: vi.fn().mockResolvedValue([]) } });
        await type(w, 'zzz');
        expect(w.text()).toContain('Nobody found');
        expect(w.findAll('[role="option"]')).toHaveLength(0);
    });

    it('a rejected search shows the error text, in the error slot if given', async () => {
        const search = vi.fn().mockRejectedValue(new Error('x'));
        const w = mount(PersonPicker, { props: { ...props, search } });
        await type(w, 'An');
        expect(w.find('[role="alert"]').text()).toContain('Search failed');
        const w2 = mount(PersonPicker, { props: { ...props, search }, slots: { error: '<b class="mine">Custom</b>' } });
        await type(w2, 'An');
        expect(w2.find('.mine').exists()).toBe(true);
    });

    it('ignores a stale answer that arrives after a newer search', async () => {
        let first!: (v: typeof people) => void;
        const search = vi
            .fn()
            .mockImplementationOnce(() => new Promise((r) => (first = r)))
            .mockResolvedValueOnce([people[1]]);
        const w = mount(PersonPicker, { props: { ...props, search } });
        await type(w, 'A');
        await type(w, 'An');
        first(people);
        await flushPromises();
        expect(w.findAll('[role="option"]')).toHaveLength(1);
    });

    it('editing the text after a selection clears the selection', async () => {
        const w = mount(PersonPicker, { props: { ...props, selected: people[0], search: vi.fn().mockResolvedValue(people) } });
        expect((w.find('input').element as HTMLInputElement).value).toBe('Anna Beck');
        await w.find('input').setValue('Anna B');
        expect(w.emitted('update:selected')!.at(-1)).toEqual([null]);
    });

    describe('closing cancels pending searches', () => {
        it('choose before the debounce fires: no search, list stays closed', async () => {
            // Open with a first result, then type again and choose from the old list before the debounce fires.
            const search = vi.fn().mockResolvedValue(people);
            const w = mount(PersonPicker, { props: { ...props, search } });
            await type(w, 'An');
            await w.find('input').setValue('Ann');
            await w.findAll('[role="option"]')[0]!.trigger('click');
            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();
            expect(search).toHaveBeenCalledTimes(1);
            expect(w.find('[role="listbox"]').exists()).toBe(false);
        });

        it('Escape before the debounce fires keeps the list closed', async () => {
            const search = vi.fn().mockResolvedValue(people);
            const w = mount(PersonPicker, { props: { ...props, search } });
            await w.find('input').setValue('An');
            await w.find('input').trigger('keydown', { key: 'Escape' });
            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();
            expect(search).not.toHaveBeenCalled();
            expect(w.find('[role="listbox"]').exists()).toBe(false);
        });

        it('blur before the debounce fires keeps the list closed', async () => {
            const search = vi.fn().mockResolvedValue(people);
            const w = mount(PersonPicker, { props: { ...props, search } });
            await w.find('input').setValue('An');
            await w.find('input').trigger('blur');
            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();
            expect(search).not.toHaveBeenCalled();
            expect(w.find('[role="listbox"]').exists()).toBe(false);
        });

        it('a search in flight that resolves after Escape or blur does not reopen', async () => {
            for (const close of [(w: ReturnType<typeof mount>) => w.find('input').trigger('keydown', { key: 'Escape' }), (w: ReturnType<typeof mount>) => w.find('input').trigger('blur')]) {
                let done!: (v: typeof people) => void;
                const search = vi.fn().mockImplementation(() => new Promise((r) => (done = r)));
                const w = mount(PersonPicker, { props: { ...props, search } });
                await w.find('input').setValue('An');
                await vi.advanceTimersByTimeAsync(250);
                expect(search).toHaveBeenCalledTimes(1);
                await close(w);
                done(people);
                await flushPromises();
                expect(w.find('[role="listbox"]').exists()).toBe(false);
                expect(w.find('input').attributes('aria-expanded')).toBe('false');
            }
        });
    });
});
