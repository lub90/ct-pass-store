import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecretField from './SecretField.vue';

const props = { label: 'Password', revealLabel: 'Show', hideLabel: 'Hide', copyLabel: 'Copy', copiedLabel: 'Copied', value: 's3cret', readonly: true };

describe('SecretField', () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.useFakeTimers();
        writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    afterEach(() => vi.useRealTimers());

    it('toggles between password and text', async () => {
        const w = mount(SecretField, { props });
        const input = w.find('input');
        expect(input.attributes('type')).toBe('password');
        const eye = w.find('button[aria-label="Show"]');
        expect(eye.attributes('aria-pressed')).toBe('false');
        await eye.trigger('click');
        expect(input.attributes('type')).toBe('text');
        expect(w.find('button[aria-label="Hide"]').attributes('aria-pressed')).toBe('true');
    });

    it('copies the value and shows the copied label for 2 s', async () => {
        const w = mount(SecretField, { props });
        await w.find('button[aria-label="Copy"]').trigger('click');
        await vi.advanceTimersByTimeAsync(0);
        expect(writeText).toHaveBeenCalledWith('s3cret');
        expect(w.find('button[aria-label="Copied"]').exists()).toBe(true);
        expect(w.find('[role="status"]').text()).toBe('Copied');
        await vi.advanceTimersByTimeAsync(1999);
        expect(w.find('button[aria-label="Copied"]').exists()).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        expect(w.find('button[aria-label="Copy"]').exists()).toBe(true);
    });

    it('keeps the label and emits copy-failed when the clipboard fails', async () => {
        writeText.mockRejectedValue(new Error('denied'));
        const w = mount(SecretField, { props });
        await w.find('button[aria-label="Copy"]').trigger('click');
        await vi.advanceTimersByTimeAsync(0);
        expect(w.emitted('copy-failed')).toHaveLength(1);
        expect(w.find('button[aria-label="Copy"]').exists()).toBe(true);
    });

    it('emits copy-failed when there is no clipboard', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        const w = mount(SecretField, { props });
        await w.find('button[aria-label="Copy"]').trigger('click');
        expect(w.emitted('copy-failed')).toHaveLength(1);
    });

    it('has no copy button without copyLabel, no eye without a reveal label pair', () => {
        const w = mount(SecretField, { props: { label: 'P', revealLabel: 'Show', hideLabel: 'Hide', value: 'x', readonly: true } });
        expect(w.findAll('button')).toHaveLength(1);
    });

    it('supports v-model when editable', async () => {
        const w = mount(SecretField, { props: { ...props, value: undefined, readonly: false, modelValue: '' } });
        await w.find('input').setValue('abc');
        expect(w.emitted('update:modelValue')![0]).toEqual(['abc']);
    });

    it('labels the input', () => {
        const w = mount(SecretField, { props });
        expect(w.find('label').attributes('for')).toBe(w.find('input').attributes('id'));
        expect(w.find('input').attributes('readonly')).toBeDefined();
    });

    it('links help and error to the input and merges a passed aria-describedby', () => {
        const w = mount(SecretField, { props: { ...props, help: 'Help', error: 'Bad' }, attrs: { 'aria-describedby': 'ext', name: 'pw' } });
        const input = w.find('input');
        const ids = input.attributes('aria-describedby')!.split(' ');
        expect(ids).toHaveLength(3);
        expect(w.find(`#${ids[0]}`).text()).toBe('Help');
        expect(w.find(`#${ids[1]}`).text()).toBe('Bad');
        expect(w.find(`#${ids[1]}`).attributes('role')).toBe('alert');
        expect(ids[2]).toBe('ext');
        expect(input.attributes('aria-invalid')).toBe('true');
        expect(input.attributes('name')).toBe('pw');
        expect(w.element.getAttribute('aria-describedby')).toBeNull();
    });

    it('puts class and style on the root, not the input', () => {
        const w = mount(SecretField, { props, attrs: { class: 'extra', style: 'margin: 1px' } });
        expect(w.classes()).toContain('extra');
        expect(w.attributes('style')).toContain('margin');
        expect(w.find('input').classes()).not.toContain('extra');
    });
});
