import type { CtValue } from '@/ct/types';
import { CtHttpError } from '@/ct/errors';
import { CategoryMissingError } from '@/model/errors';
import type { KvBackend } from './kv';

export interface RecordedWrite {
    kind: 'create' | 'update' | 'delete';
    category: string;
    valueId: number;
    value?: string;
}

/** In-memory `KvBackend` for tests and the demo. `failFromWrite` = the n-th write (1-based) and all later ones throw. */
export class MemoryKv implements KvBackend {
    writes: RecordedWrite[] = [];
    failFromWrite?: number;
    private data = new Map<string, CtValue[]>();
    private nextId = 1;
    private nextCategoryId = 1;
    private categoryIds = new Map<string, number>();

    constructor(seed: Record<string, string[]> = {}) {
        for (const [name, values] of Object.entries(seed)) {
            this.addCategory(name);
            for (const value of values) this.put(name, value);
        }
    }

    addCategory(name: string): void {
        if (!this.data.has(name)) {
            this.data.set(name, []);
            this.categoryIds.set(name, this.nextCategoryId++);
        }
    }

    private put(category: string, value: string): CtValue {
        const v = { id: this.nextId++, dataCategoryId: this.categoryIds.get(category) ?? 0, value };
        this.data.get(category)?.push(v);
        return v;
    }

    private list(category: string): CtValue[] {
        const list = this.data.get(category);
        if (!list) throw new CategoryMissingError(category);
        return list;
    }

    private beginWrite(write: RecordedWrite): void {
        if (this.failFromWrite !== undefined && this.writes.length + 1 >= this.failFromWrite) throw new Error('MemoryKv: write failed');
        this.writes.push(write);
    }

    async categoryNames() {
        return [...this.data.keys()];
    }

    async values(category: string) {
        return (this.data.get(category) ?? []).map((v) => ({ ...v }));
    }

    async create(category: string, value: string) {
        this.list(category);
        this.beginWrite({ kind: 'create', category, valueId: this.nextId, value });
        return { ...this.put(category, value) };
    }

    async update(category: string, valueId: number, value: string) {
        const v = this.list(category).find((x) => x.id === valueId);
        if (!v) throw new CtHttpError(404, 'Value not found');
        this.beginWrite({ kind: 'update', category, valueId, value });
        v.value = value;
        return { ...v };
    }

    async delete(category: string, valueId: number) {
        const list = this.list(category);
        if (!list.some((x) => x.id === valueId)) throw new CtHttpError(404, 'Value not found');
        this.beginWrite({ kind: 'delete', category, valueId });
        this.data.set(category, list.filter((x) => x.id !== valueId));
    }
}
