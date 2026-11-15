import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMachineClients } from './machine-clients';

interface Single { name: string; client: unknown; valid: boolean; reasons: string[] }
interface Multi { name: string; clients: unknown[]; enabled: string[]; reasons: string[][] }
interface Raw { name: string; machineClients: unknown; enabled: string[] }
type Case = Single | Multi | Raw;

// The parity fixture shared with the backend (spec backend 3.2): both sides read the same file.
const file = resolve(process.cwd(), '../shared/access-client-cases.json'); // tests run from extension/
const cases = JSON.parse(readFileSync(file, 'utf8')) as Case[];

describe('access reader matches the backend fixture', () => {
    it('has cases of all three forms', () => {
        expect(cases.some((c) => 'client' in c)).toBe(true);
        expect(cases.some((c) => 'clients' in c)).toBe(true);
        expect(cases.some((c) => 'machineClients' in c)).toBe(true);
    });

    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
        if ('client' in c) {
            const r = readMachineClients([c.client]);
            expect(r.entries[0]?.reasons).toEqual(c.reasons);
            expect(r.clients.length === 1).toBe(c.valid);
        } else if ('clients' in c) {
            const r = readMachineClients(c.clients);
            expect(r.clients.map((x) => x.id)).toEqual(c.enabled);
            expect(r.entries.map((e) => e.reasons)).toEqual(c.reasons);
        } else {
            const r = readMachineClients(c.machineClients);
            expect(r.clients).toEqual([]);
            expect(r.notAList).toBe(true);
        }
    });

    it('lists every disabled entry as unusable, with a reason even for the earlier duplicate', () => {
        const entry = { id: 'same', name: 'n', publicKeys: ['AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='], createdAt: '2026-01-01' };
        const r = readMachineClients([entry, { ...entry, publicKeys: ['AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI='] }]);
        expect(r.clients).toEqual([]);
        expect(r.unusable).toEqual([
            { index: 0, id: 'same', reasons: ['duplicate-id'] },
            { index: 1, id: 'same', reasons: ['duplicate-id'] },
        ]);
    });

    it('gives the earlier entries of a duplicate id the code too, in canonical order', () => {
        const key = (c: string) => btoa(c.repeat(32));
        const entry = { id: 'same', name: 'n', publicKeys: [key('a')], createdAt: '2026-01-01' };
        const r = readMachineClients([{ ...entry, name: '' }, { ...entry, publicKeys: [key('b')] }, { ...entry, publicKeys: [key('c')] }]);
        expect(r.entries.map((e) => e.reasons)).toEqual([['duplicate-id', 'missing-name'], ['duplicate-id'], ['duplicate-id']]);
    });

    it('trims the name (PHP set) in the parsed client and treats missing permissions as none', () => {
        const entry = { id: 'abc', name: ' \tName\n', publicKeys: ['AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='], createdAt: '2026-01-01' };
        const r = readMachineClients([entry]);
        expect(r.clients[0]).toMatchObject({ name: 'Name', permissions: [] });
    });

    it('treats a missing or null list as empty', () => {
        expect(readMachineClients(undefined)).toMatchObject({ clients: [], notAList: false });
        expect(readMachineClients(null)).toMatchObject({ clients: [], notAList: false });
    });
});
