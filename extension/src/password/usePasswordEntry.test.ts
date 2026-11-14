/** `usePasswordEntry`: the newest action decides the status, not a slower read that started earlier. */
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { SERVICES_KEY, type Services } from '../app/services';
import { APP_STATE_KEY, type AppStateHandle } from '../app/useAppState';
import { SESSION_KEY, type Session } from '../app/useSession';
import type { BackendApi } from '../backend/api';
import { usePasswordEntry, type PasswordEntry } from './usePasswordEntry';

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

function setup() {
    const reads: ReturnType<typeof deferred<'set' | 'none'>>[] = [];
    const api = {
        getEntry: () => {
            const d = deferred<'set' | 'none'>();
            reads.push(d);
            return d.promise;
        },
        putEntry: async (_id: number, body: { secondaryPwd?: string }) => (body.secondaryPwd === undefined ? { generated: 'Gen3rated!pass' } : {}),
        deleteEntry: async () => undefined,
    } as unknown as BackendApi;
    const services = { backend: () => api } as unknown as Services;
    const session = { call: <T,>(fn: () => Promise<T>) => fn() } as unknown as Session;
    const app = { settings: ref({ backendUrl: 'https://pw.example' }) } as unknown as AppStateHandle;
    let entry!: PasswordEntry;
    mount(
        defineComponent({
            setup() {
                entry = usePasswordEntry(5);
                return () => h('div');
            },
        }),
        { global: { provide: { [SERVICES_KEY as symbol]: services, [SESSION_KEY as symbol]: session, [APP_STATE_KEY as symbol]: app } } },
    );
    return { entry: () => entry, reads };
}

describe('usePasswordEntry', () => {
    it.each([
        ['generate', (e: PasswordEntry) => e.generate(), 'set'],
        ['setCustom', (e: PasswordEntry) => e.setCustom('Abcdefgh1234!x'), 'set'],
        ['remove', (e: PasswordEntry) => e.remove(), 'none'],
    ] as const)('a slower read started before %s cannot overwrite the newer status', async (_name, act, expected) => {
        const { entry, reads } = setup();
        expect(reads).toHaveLength(1);
        await act(entry());
        await flushPromises();
        // The stale first read answers last, with the old state.
        reads[0]!.resolve(expected === 'set' ? 'none' : 'set');
        await flushPromises();
        expect(entry().status.value).not.toBe(expected === 'set' ? 'none' : 'set');
        // A read after the action (if any) decides.
        for (const r of reads.slice(1)) r.resolve(expected);
        await flushPromises();
        expect(entry().status.value).toBe(expected);
    });
});
