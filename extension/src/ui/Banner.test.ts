import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Banner from './Banner.vue';

describe('Banner', () => {
    it('is an alert for errors', () => {
        const w = mount(Banner, { props: { kind: 'error' }, slots: { default: 'Broken' } });
        expect(w.attributes('role')).toBe('alert');
        expect(w.text()).toContain('Broken');
    });

    it.each(['info', 'warning'] as const)('is a status for %s', (kind) => {
        const w = mount(Banner, { props: { kind }, slots: { default: 'Note' } });
        expect(w.attributes('role')).toBe('status');
        expect(w.classes()).toContain(`cps-banner--${kind}`);
    });

    it('shows an optional title', () => {
        const w = mount(Banner, { props: { kind: 'info', title: 'Heads up' }, slots: { default: 'Body' } });
        expect(w.find('.cps-banner__title').text()).toBe('Heads up');
        expect(mount(Banner, { props: { kind: 'info' } }).find('.cps-banner__title').exists()).toBe(false);
    });
});
