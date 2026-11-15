/**
 * App layer (mounted): „Über“ (spec 4.9) for everyone with access. Versions, and links built only from constants and
 * the extension's version: the tag for a release, `main` for a development build.
 */
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_PATH } from '../config';
import { cleanup, start } from './settings/settings-harness';

afterEach(cleanup);

const REPO = 'https://github.com/lub90/ct-pass-store';
const link = (w: VueWrapper, text: string) => {
    const found = w.findAll('main a').find((a) => a.text() === text);
    if (!found) throw new Error(`No link „${text}“ in: ${w.text()}`);
    return found;
};

describe('Über (spec 4.9)', () => {
    it('a normal user sees what the extension does and both versions', async () => {
        const { wrapper } = await start({ path: '/about', admin: false, appVersion: '0.1.2', backendVersion: '0.1.5' });
        expect(wrapper.find('h1').text()).toBe('Über');
        expect(wrapper.find('.cps-page-head').text()).toContain('CtPassStore gibt jeder Person ein eigenes Zweitpasswort');
        expect(wrapper.find('.cps-about__versions').text()).toContain('Erweiterung: Version 0.1.2');
        expect(wrapper.find('.cps-about__versions').text()).toContain('Backend: Version 0.1.5');
    });

    it('links guide, release notes and LICENSE at the tag of a release, safely', async () => {
        const { wrapper } = await start({ path: '/about', appVersion: '0.1.2' });
        expect(link(wrapper, 'Anleitung für diese Version').attributes('href')).toBe(`${REPO}/blob/extension-v0.1.2/extension/docs/user-guide.md`);
        expect(link(wrapper, 'Neuigkeiten').attributes('href')).toBe(`${REPO}/releases/tag/extension-v0.1.2`);
        expect(link(wrapper, '© 2025 Lukas Block · MIT-Lizenz').attributes('href')).toBe(`${REPO}/blob/extension-v0.1.2/LICENSE`);
        expect(link(wrapper, 'Lizenzen der verwendeten Bibliotheken').attributes('href')).toBe(`${BASE_PATH}THIRD-PARTY-LICENSES.txt`);
        for (const a of wrapper.findAll('main a[target="_blank"]')) expect(a.attributes('rel')).toBe('noopener noreferrer');
        expect(wrapper.findAll('main a[target="_blank"]')).toHaveLength(4);
    });

    it('a development build links to main', async () => {
        const { wrapper } = await start({ path: '/about', appVersion: '0.1.2+abc1234-dirty' });
        expect(link(wrapper, 'Anleitung für diese Version').attributes('href')).toBe(`${REPO}/blob/main/extension/docs/user-guide.md`);
        expect(link(wrapper, '© 2025 Lukas Block · MIT-Lizenz').attributes('href')).toBe(`${REPO}/blob/main/LICENSE`);
        expect(wrapper.find('.cps-about__versions').text()).toContain('Erweiterung: Version 0.1.2+abc1234-dirty');
    });
});
