import { describe, expect, it } from 'vitest';
import { CategoryMissingError } from '@/model/errors';
import type { KvBackend } from './kv';

/** Behaviour every `KvBackend` must share. `make` builds a store seeded with `{ category: [values] }` (IDs run 1, 2, ... in order). */
export function defineKvContract(name: string, make: (seed: Record<string, string[]>) => KvBackend): void {
    describe(`KvBackend contract: ${name}`, () => {
        it('lists category names', async () => {
            expect(await make({ settings: [], access: ['{}'] }).categoryNames()).toEqual(['settings', 'access']);
        });

        it('returns [] for an unknown category', async () => {
            expect(await make({ settings: [] }).values('nope')).toEqual([]);
        });

        it('creates, lists, updates and deletes', async () => {
            const kv = make({ settings: ['a'], access: ['x'] });
            const created = await kv.create('settings', 'b');
            expect(created.value).toBe('b');
            expect((await kv.values('settings')).map((v) => v.value)).toEqual(['a', 'b']);
            await kv.update('settings', created.id, 'c');
            expect((await kv.values('settings')).map((v) => v.value)).toEqual(['a', 'c']);
            await kv.delete('settings', created.id);
            expect((await kv.values('settings')).map((v) => v.value)).toEqual(['a']);
            expect((await kv.values('access')).map((v) => v.value)).toEqual(['x']);
        });

        it('rejects update and delete of an unknown value with HTTP 404', async () => {
            const kv = make({ settings: ['a'] });
            await expect(kv.update('settings', 99, 'z')).rejects.toMatchObject({ name: 'CtHttpError', status: 404 });
            await expect(kv.delete('settings', 99)).rejects.toMatchObject({ name: 'CtHttpError', status: 404 });
        });

        it('rejects a value of another category as unknown', async () => {
            const kv = make({ settings: ['a'], access: ['x'] });
            await expect(kv.update('settings', 2, 'z')).rejects.toMatchObject({ status: 404 });
        });

        it('rejects writes to a missing category', async () => {
            const kv = make({ settings: [] });
            await expect(kv.create('nope', 'x')).rejects.toBeInstanceOf(CategoryMissingError);
            await expect(kv.update('nope', 1, 'x')).rejects.toBeInstanceOf(CategoryMissingError);
            await expect(kv.delete('nope', 1)).rejects.toBeInstanceOf(CategoryMissingError);
        });
    });
}
