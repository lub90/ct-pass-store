import type { CtValue } from '@/ct/types';

/** The KV store by category name; mirrors the API (`CtApi`). A missing category has no values. */
export interface KvBackend {
    categoryNames(): Promise<string[]>;
    values(category: string): Promise<CtValue[]>;
    /** Rejects with `CategoryMissingError` when the category doesn't exist. */
    create(category: string, value: string): Promise<CtValue>;
    update(category: string, valueId: number, value: string): Promise<CtValue>;
    delete(category: string, valueId: number): Promise<void>;
}
