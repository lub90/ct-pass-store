import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import LinkCard from './LinkCard.vue';

const RouterLink = defineComponent({
    props: { to: { type: String, required: true } },
    setup: (p, { slots }) => () => h('a', { class: 'router-link', href: `#${p.to}` }, slots.default?.()),
});
const base = { to: '/x', icon: 'key' as const, title: 'Title', text: 'Sentence' };

describe('LinkCard', () => {
    it('renders the registered RouterLink', () => {
        const w = mount(LinkCard, { props: { ...base, pill: 'Ready', pillKind: 'ok' }, global: { components: { RouterLink } } });
        expect(w.find('a.router-link').attributes('href')).toBe('#/x');
        expect(w.text()).toContain('Title');
        expect(w.text()).toContain('Sentence');
        expect(w.text()).toContain('Ready');
    });

    it('falls back to a plain anchor without a router', () => {
        const w = mount(LinkCard, { props: base });
        expect(w.find('a').attributes('href')).toBe('/x');
    });

    it('disabled renders no link and shows the reason', () => {
        const w = mount(LinkCard, { props: { ...base, disabledReason: 'Not allowed' }, global: { components: { RouterLink } } });
        expect(w.find('a').exists()).toBe(false);
        expect(w.text()).toContain('Not allowed');
        expect(w.attributes('aria-disabled')).toBe('true');
    });
});
