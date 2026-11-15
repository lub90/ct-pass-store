import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Field from './Field.vue';

const control = '<input :id="id" :aria-describedby="describedby" :aria-invalid="invalid || undefined">';
const slot = { default: `<template #default="{ id, describedby, invalid }">${control}</template>` };

describe('Field', () => {
    it('labels the control by id', () => {
        const w = mount(Field, { props: { label: 'Name', id: 'n' }, slots: slot });
        expect(w.find('label').attributes('for')).toBe('n');
        expect(w.find('input').attributes('id')).toBe('n');
    });

    it('links help and error to the control', () => {
        const w = mount(Field, { props: { label: 'Name', id: 'n', help: 'Some help', error: 'Too short' }, slots: slot });
        const ids = w.find('input').attributes('aria-describedby')!.split(' ');
        expect(ids).toHaveLength(2);
        expect(w.find(`#${ids[0]}`).text()).toBe('Some help');
        expect(w.find(`#${ids[1]}`).text()).toBe('Too short');
        expect(w.find(`#${ids[1]}`).attributes('role')).toBe('alert');
        expect(w.find('input').attributes('aria-invalid')).toBe('true');
    });

    it('has no describedby without help or error', () => {
        const w = mount(Field, { props: { label: 'Name', id: 'n' }, slots: slot });
        expect(w.find('input').attributes('aria-describedby')).toBeUndefined();
    });
});
