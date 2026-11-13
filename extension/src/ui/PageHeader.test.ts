import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader.vue';

describe('PageHeader', () => {
    it('renders title and intro', () => {
        const w = mount(PageHeader, { props: { icon: 'key', title: 'Password store', intro: 'Your passwords.' } });
        expect(w.find('h1').text()).toBe('Password store');
        expect(w.text()).toContain('Your passwords.');
        expect(w.find('svg').attributes('aria-hidden')).toBe('true');
    });

    it('renders the actions slot', () => {
        const w = mount(PageHeader, {
            props: { icon: 'key', title: 'T', intro: 'I' },
            slots: { actions: '<button>Do</button>' },
        });
        expect(w.find('.cps-page-head__actions button').text()).toBe('Do');
    });

    it('omits the actions container without a slot', () => {
        const w = mount(PageHeader, { props: { icon: 'key', title: 'T', intro: 'I' } });
        expect(w.find('.cps-page-head__actions').exists()).toBe(false);
    });
});
