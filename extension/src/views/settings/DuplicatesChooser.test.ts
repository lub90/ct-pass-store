/** The chooser alone: a list read again while the question is open is never resolved with the old list (C1). */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVICES_KEY, type Services } from '../../app/services';
import { createAppI18n } from '../../i18n';
import { MemoryKv } from '../../store/memory-kv';
import { ExtensionStore, type StoredValue } from '../../store/repository';
import { answerConfirm } from '../../ui/useConfirm';
import DuplicatesChooser from './DuplicatesChooser.vue';

afterEach(() => answerConfirm({ confirmed: false }));

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
        await wrapper.findAll('button').find((b) => b.text() === 'Diesen Wert behalten')!.trigger('click');
        await wrapper.setProps({ values: [...read.values] as StoredValue<unknown>[] });
        answerConfirm({ confirmed: true });
        await flushPromises();
        expect(resolve).not.toHaveBeenCalled();
        expect(kv.writes).toEqual([]);
        expect(wrapper.emitted('resolved')).toBeUndefined();
        wrapper.unmount();
    });
});
