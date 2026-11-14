/** `usePasswordEntry`: which answer decides the status, and what a change announces. */
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';
import { SERVICES_KEY, type Services } from '../app/services';
import { APP_STATE_KEY, type AppStateHandle } from '../app/useAppState';
import { SESSION_KEY, type Session } from '../app/useSession';
import type { BackendApi } from '../backend/api';
import { UnexpectedResponse } from '../backend/problems';
import { usePasswordEntry, type PasswordEntry } from './usePasswordEntry';

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type Read = ReturnType<typeof deferred<'set' | 'none'>> & { id: number };

function setup(options: { load?: boolean; person?: Ref<number | null>; put?: BackendApi['putEntry'] } = {}) {
    const reads: Read[] = [];
    const api = {
        getEntry: (id: number) => {
            const d = { ...deferred<'set' | 'none'>(), id };
            reads.push(d);
            return d.promise;
        },
        putEntry: options.put ?? (async (_id: number, body: { secondaryPwd?: string }) => (body.secondaryPwd === undefined ? { generated: 'Gen3rated!pass' } : {})),
        deleteEntry: async () => undefined,
    } as unknown as BackendApi;
    const services = { backend: () => api } as unknown as Services;
    const session = { call: <T,>(fn: () => Promise<T>) => fn() } as unknown as Session;
    const app = { settings: ref({ backendUrl: 'https://pw.example' }) } as unknown as AppStateHandle;
    const person = options.person ?? ref<number | null>(5);
    const entries: PasswordEntry[] = [];
    const make = (load = options.load) =>
        mount(
            defineComponent({
                setup() {
                    entries.push(usePasswordEntry(person, { load }));
                    return () => h('div');
                },
            }),
            { global: { provide: { [SERVICES_KEY as symbol]: services, [SESSION_KEY as symbol]: session, [APP_STATE_KEY as symbol]: app } } },
        );
    make();
    return { entry: () => entries[0]!, entries, reads, person, make };
}

const ACTIONS = [
    ['generate', (e: PasswordEntry) => e.generate(), 'set'],
    ['setCustom', (e: PasswordEntry) => e.setCustom('Abcdefgh1234!x'), 'set'],
    ['remove', (e: PasswordEntry) => e.remove(), 'none'],
] as const;

describe('usePasswordEntry', () => {
    it.each(ACTIONS)('without loading, %s sets the status itself', async (_name, act, expected) => {
        const { entry, reads } = setup({ load: false });
        expect(reads).toHaveLength(0);
        await act(entry());
        expect(entry().status.value).toBe(expected);
        expect(reads).toHaveLength(0);
    });

    it.each(ACTIONS)('after %s a loaded entry reads again; the read started before it is ignored', async (_name, act, expected) => {
        const { entry, reads } = setup();
        expect(reads).toHaveLength(1);
        await act(entry());
        await flushPromises();
        expect(reads).toHaveLength(2);
        reads[0]!.resolve(expected === 'set' ? 'none' : 'set');
        await flushPromises();
        expect(entry().status.value).toBe('loading');
        reads[1]!.resolve(expected);
        await flushPromises();
        expect(entry().status.value).toBe(expected);
    });

    it('a stale read failing after a newer change sets no error', async () => {
        const { entry, reads } = setup();
        await entry().generate();
        await flushPromises();
        reads[0]!.reject(new Error('late'));
        await flushPromises();
        expect(entry().status.value).not.toBe('error');
        expect(entry().error.value).toBeNull();
    });

    it('a change announces itself to every loaded entry of the person, also one mounted later', async () => {
        const { entry, reads, make } = setup({ load: false });
        make(true);
        expect(reads).toHaveLength(1);
        await entry().generate();
        await flushPromises();
        expect(reads).toHaveLength(2);
    });

    it('another person while a read is pending: the late answer for the first one is ignored', async () => {
        const person = ref<number | null>(5);
        const { entry, reads } = setup({ person });
        person.value = 6;
        await flushPromises();
        expect(reads.map((r) => r.id)).toEqual([5, 6]);
        reads[1]!.resolve('none');
        await flushPromises();
        reads[0]!.resolve('set');
        await flushPromises();
        expect(entry().status.value).toBe('none');
    });

    it('generate() rejects an answer without a password', async () => {
        const { entry } = setup({ load: false, put: async () => ({}) });
        await expect(entry().generate()).rejects.toBeInstanceOf(UnexpectedResponse);
    });
});
