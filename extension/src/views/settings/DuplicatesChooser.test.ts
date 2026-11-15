/** The chooser alone: a list read again while the question is open is never resolved with the old list (C1). */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVICES_KEY, type Services } from '../../app/services';
import { createAppI18n } from '../../i18n';
import { CtHttpError } from '../../ct/errors';
import { MemoryKv } from '../../store/memory-kv';
import { ExtensionStore, type StoredValue } from '../../store/repository';
import { answerConfirm, pendingConfirm } from '../../ui/useConfirm';
import DuplicatesChooser from './DuplicatesChooser.vue';

/** Every mounted chooser, unmounted after each test even when an assertion failed. */
const mounted: VueWrapper[] = [];

afterEach(() => {
    answerConfirm({ confirmed: false });
    while (mounted.length) mounted.pop()!.unmount();
});

const settings = { schema: 2, revision: 1, requirePasswordForPasswordChange: true, allowCustomPassword: false, passwordLength: 16, backendUrl: 'https://pw.example' };

describe('DuplicatesChooser', () => {
    it('a list replaced while the question is open: nothing is resolved, nothing emitted', async () => {
        const kv = new MemoryKv({ settings: [JSON.stringify(settings), JSON.stringify({ ...settings, backendUrl: 'https://evil.example' })] });
        const store = new ExtensionStore(kv);
        const read = await store.readSettings();
        if (read.state !== 'duplicates') throw new Error('not duplicates');
        const resolve = vi.spyOn(store, 'resolveDuplicates');
        const wrapper = mount(DuplicatesChooser, {
            props: { category: 'settings', values: read.values as StoredValue<unknown>[] },
            global: { plugins: [createAppI18n('de')], provide: { [SERVICES_KEY as symbol]: { store } as unknown as Services } },
        });
        mounted.push(wrapper);
        await wrapper.findAll('button').find((b) => b.text() === 'Diesen Wert behalten')!.trigger('click');
        await wrapper.setProps({ values: [...read.values] as StoredValue<unknown>[] });
        answerConfirm({ confirmed: true });
        await flushPromises();
        expect(resolve).not.toHaveBeenCalled();
        expect(kv.writes).toEqual([]);
        expect(wrapper.emitted('resolved')).toBeUndefined();
    });

    async function chooser(category: 'settings' | 'access', ...texts: unknown[]) {
        const kv = new MemoryKv({ [category]: texts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) });
        const store = new ExtensionStore(kv);
        const read = category === 'settings' ? await store.readSettings() : await store.readAccess();
        if (read.state !== 'duplicates') throw new Error('not duplicates');
        const wrapper = mount(DuplicatesChooser, {
            props: { category, values: read.values as StoredValue<unknown>[] },
            global: { plugins: [createAppI18n('de')], provide: { [SERVICES_KEY as symbol]: { store } as unknown as Services } },
        });
        mounted.push(wrapper);
        const keep = async (id: number) => {
            const card = wrapper.find(`.cps-duplicates__value[data-value-id="${id}"]`);
            await card.findAll('button').find((b) => b.text() === 'Diesen Wert behalten')!.trigger('click');
        };
        return { wrapper, store, kv, keep };
    }

    it('an invalid value states its number of problems (spec 6.2)', async () => {
        const { wrapper } = await chooser('settings', { ...settings, passwordLength: 5 }, { ...settings, passwordLength: 5, allowCustomPassword: 'x' });
        expect(wrapper.find('.cps-duplicates__value[data-value-id="1"]').text()).toContain('ungültig (ein Problem)');
        expect(wrapper.find('.cps-duplicates__value[data-value-id="2"]').text()).toContain('ungültig (2 Probleme)');
    });

    it.each(['settings', 'access'] as const)('the dialog subject names the value and the category (%s)', async (category) => {
        const access = { schema: 2, revision: 1, groups: { users: { groupId: 1, createdBySetup: true }, admins: { groupId: 2, createdBySetup: true }, service: { groupId: 3, createdBySetup: true } }, machineClients: [] };
        const value = category === 'settings' ? settings : access;
        const { wrapper, keep } = await chooser(category, value, { ...value, revision: 2 });
        await keep(2);
        expect(pendingConfirm.value?.subject).toEqual({ name: 'Wert 2', detail: category });
        answerConfirm({ confirmed: false });
        await flushPromises();
    });

    it('an error from a failed try is gone once the next try starts, also when that one is cancelled', async () => {
        const { wrapper, store, keep } = await chooser('settings', settings, { ...settings, backendUrl: 'https://evil.example' });
        vi.spyOn(store, 'resolveDuplicates').mockRejectedValueOnce(new CtHttpError(500, 'boom'));
        await keep(1);
        answerConfirm({ confirmed: true });
        await flushPromises();
        expect(wrapper.find('.cps-duplicates__error').text()).toBe('ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.');
        await keep(1);
        answerConfirm({ confirmed: false });
        await flushPromises();
        expect(wrapper.find('.cps-duplicates__error').exists()).toBe(false);
    });
});
