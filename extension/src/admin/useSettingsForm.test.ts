/* eslint-disable vue/one-component-per-file -- each test mounts its own small page around the form */
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { CtForbiddenError, CtHttpError, CtRateLimitedError, NotAuthenticatedError } from '../ct/errors';
import { CategoryMissingError, InvalidValueError, ValueTooLargeError } from '../model/errors';
import type { Read } from '../store/repository';
import { settingsErrorText, useSettingsForm, type SettingsForm } from './useSettingsForm';

// The form asks before leaving through the router; these tests mount it without one.
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => undefined, onBeforeRouteUpdate: () => undefined }));

describe('settingsErrorText', () => {
    it.each([
        ['a missing right (named)', new CtForbiddenError('x', 'create custom data'), { key: 'settings.missingRight', params: { right: 'create custom data', category: 'settings' } }],
        ['a missing right (unnamed)', new CtForbiddenError(), { key: 'settings.missingRight', params: { right: 'edit custom data', category: 'settings' } }],
        ['the rate limit', new CtRateLimitedError(150_000), { key: 'state.ctRateLimited', params: { n: 3 } }],
        ['logged out', new NotAuthenticatedError(), { key: 'manage.ctLoggedOut', params: {} }],
        ['too large', new ValueTooLargeError(10_500, 10_000), { key: 'settings.tooLarge', params: { size: 10_500, limit: 10_000 } }],
        ['an invalid value', new InvalidValueError(['x']), { key: 'settings.notSaved', params: {} }],
        ['a missing category', new CategoryMissingError('settings'), { key: 'settings.categoryMissing', params: { category: 'settings' } }],
        ['anything else', new CtHttpError(500), { key: 'state.ctUnavailable', params: {} }],
    ])('%s', (_n, error, expected) => {
        expect(settingsErrorText(error)).toStrictEqual(expected);
    });
});

describe('settingsErrorText for another category', () => {
    it('names that category for a missing right and a missing category', () => {
        expect(settingsErrorText(new CtForbiddenError(), 'access')).toStrictEqual({ key: 'settings.missingRight', params: { right: 'edit custom data', category: 'access' } });
        expect(settingsErrorText(new CategoryMissingError('access'), 'access')).toStrictEqual({ key: 'settings.categoryMissing', params: { category: 'access' } });
        expect(settingsErrorText(new InvalidValueError(['x']), 'access')).toStrictEqual({ key: 'access.notSaved', params: {} });
    });
});

describe('useSettingsForm: overlapping loads', () => {
    type V = { revision: number; name: string };
    const ok = (name: string): Read<V> => ({ state: 'ok', value: { revision: 1, name }, valueId: 1, duplicates: 0 });

    /** Mounts a page that only holds the form; each `load()` waits for its own `resolve`/`reject`. */
    function setup() {
        const pending: { resolve: (r: Read<V>) => void; reject: (e: unknown) => void }[] = [];
        let form!: SettingsForm<V>;
        const Page = defineComponent({
            setup() {
                form = useSettingsForm<V>(
                    () => new Promise<Read<V>>((resolve, reject) => pending.push({ resolve, reject })),
                    () => Promise.resolve(),
                    { confirm: () => Promise.resolve({ confirmed: true }), leaveQuestion: () => ({ title: 't', text: 't', confirmLabel: 'c', cancelLabel: 'x' }) },
                );
                return () => h('div');
            },
        });
        const wrapper = mount(Page);
        return { form: () => form, pending, wrapper };
    }

    it('the newer read wins when the older one answers last', async () => {
        const { form, pending, wrapper } = setup();
        void form().load();
        void form().load();
        pending[1]!.resolve(ok('newer'));
        await flushPromises();
        pending[0]!.resolve(ok('older'));
        await flushPromises();
        expect(form().status.value).toBe('ready');
        expect(form().value.value?.name).toBe('newer');
        wrapper.unmount();
    });

    it('an older read failing last changes nothing', async () => {
        const { form, pending, wrapper } = setup();
        void form().load();
        void form().load();
        pending[1]!.resolve(ok('newer'));
        await flushPromises();
        pending[0]!.reject(new Error('late'));
        await flushPromises();
        expect(form().status.value).toBe('ready');
        expect(form().loadError.value).toBeNull();
        wrapper.unmount();
    });
});

describe('useSettingsForm: prepare', () => {
    type V = { revision: number; list: string[] };

    it('shows the prepared value as the unchanged state: not dirty until edited; discard returns to it', async () => {
        let form!: SettingsForm<V>;
        const saved: V[] = [];
        const Page = defineComponent({
            setup() {
                form = useSettingsForm<V>(
                    () => Promise.resolve({ state: 'ok', value: { revision: 3, list: ['a'] }, valueId: 1, duplicates: 0 }),
                    (value) => (saved.push(value), Promise.resolve()),
                    {
                        prepare: (stored) => ({ ...stored, list: [...stored.list, 'draft'] }),
                        confirm: () => Promise.resolve({ confirmed: true }),
                        leaveQuestion: () => ({ title: 't', text: 't', confirmLabel: 'c', cancelLabel: 'x' }),
                    },
                );
                return () => h('div');
            },
        });
        const wrapper = mount(Page);
        await form.load();
        expect(form.value.value).toEqual({ revision: 3, list: ['a', 'draft'] });
        expect(form.dirty.value).toBe(false);
        form.value.value!.list[1] = 'typed';
        expect(form.dirty.value).toBe(true);
        form.discard();
        expect(form.value.value).toEqual({ revision: 3, list: ['a', 'draft'] });
        form.value.value!.list[1] = 'typed';
        await form.save();
        expect(saved).toEqual([{ revision: 3, list: ['a', 'typed'] }]);
        wrapper.unmount();
    });
});
