import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import PageFrame from './PageFrame.vue';

const RouterLink = defineComponent({
    props: { to: { type: String, required: true } },
    setup: (p, { slots, attrs }) => () => h('a', { ...attrs, href: `#${p.to}` }, slots.default?.()),
});
const nav = [
    { to: '/a', label: 'Alpha', icon: 'key' as const },
    { to: '/b', label: 'Beta', icon: 'lock' as const },
    { to: '/z', label: 'Zed', icon: 'info' as const, bottom: true },
];
const slots = { default: '<p class="content">Hello</p>' };

describe('PageFrame', () => {
    it('card: renders the content in a card and no navigation', () => {
        const w = mount(PageFrame, { props: { mode: 'card', nav, navLabel: 'Menu' }, slots });
        expect(w.find('nav').exists()).toBe(false);
        expect(w.find('select').exists()).toBe(false);
        expect(w.find('.cps-frame--card').exists()).toBe(true);
        expect(w.find('.content').exists()).toBe(true);
    });

    it('sidebar: a labelled nav with every entry, bottom ones after the spacer', () => {
        const w = mount(PageFrame, { props: { mode: 'sidebar', nav, navLabel: 'Menu' }, slots, global: { components: { RouterLink } } });
        const navEl = w.find('nav');
        expect(navEl.attributes('aria-label')).toBe('Menu');
        const links = navEl.findAll('a');
        expect(links.map((a) => a.text())).toEqual(['Alpha', 'Beta', 'Zed']);
        const spacer = navEl.find('.cps-frame__spacer');
        expect(spacer.exists()).toBe(true);
        const html = navEl.html();
        expect(html.indexOf('Beta')).toBeLessThan(html.indexOf('cps-frame__spacer'));
        expect(html.indexOf('cps-frame__spacer')).toBeLessThan(html.indexOf('Zed'));
        expect(w.find('.content').exists()).toBe(true);
    });

    it('sidebar: the active entry has aria-current="page"', () => {
        const w = mount(PageFrame, { props: { mode: 'sidebar', nav, navLabel: 'Menu', current: '/b' }, slots, global: { components: { RouterLink } } });
        const current = w.findAll('nav a[aria-current="page"]');
        expect(current).toHaveLength(1);
        expect(current[0]!.text()).toBe('Beta');
    });

    it('sidebar: the phone dropdown is a labelled select with the entries; choosing one emits navigate', async () => {
        const w = mount(PageFrame, { props: { mode: 'sidebar', nav, navLabel: 'Menu', current: '/b' }, slots, global: { components: { RouterLink } } });
        const select = w.find('select');
        expect(select.attributes('aria-label')).toBe('Menu');
        expect(select.findAll('option').map((o) => o.text())).toEqual(['Alpha', 'Beta', 'Zed']);
        expect((select.element as HTMLSelectElement).value).toBe('/b');
        await select.setValue('/z');
        expect(w.emitted('navigate')![0]).toEqual(['/z']);
    });

    it('falls back to plain anchors without a router', () => {
        const w = mount(PageFrame, { props: { mode: 'sidebar', nav, navLabel: 'Menu' }, slots });
        expect(w.find('nav a').attributes('href')).toBe('/a');
    });
});
