import type { CtApi } from '@/ct/api';
import type { CtCategory } from '@/ct/types';
import { CategoryMissingError } from '@/model/errors';
import type { KvBackend } from './kv';

/** `KvBackend` over ChurchTools. Looks the module up once, categories on every call (they can appear meanwhile). */
export class ChurchToolsKv implements KvBackend {
    private module: Promise<number> | undefined;

    private readonly api: CtApi;
    private readonly moduleKey: string;

    constructor(api: CtApi, moduleKey: string) {
        this.api = api;
        this.moduleKey = moduleKey;
    }

    private moduleId(): Promise<number> {
        this.module ??= this.api.moduleId(this.moduleKey).then((id) => {
            if (id === null) throw new Error(`Extension module "${this.moduleKey}" not found`);
            return id;
        });
        this.module.catch(() => (this.module = undefined));
        return this.module;
    }

    private async list(): Promise<{ moduleId: number; categories: CtCategory[] }> {
        const moduleId = await this.moduleId();
        return { moduleId, categories: await this.api.categories(moduleId) };
    }

    private async find(name: string): Promise<{ moduleId: number; category: CtCategory | undefined }> {
        const { moduleId, categories } = await this.list();
        return { moduleId, category: categories.find((c) => c.name === name) };
    }

    private async need(name: string): Promise<{ moduleId: number; category: CtCategory }> {
        const { moduleId, category } = await this.find(name);
        if (!category) throw new CategoryMissingError(name);
        return { moduleId, category };
    }

    async categoryNames() {
        return (await this.list()).categories.map((c) => c.name);
    }

    async values(category: string) {
        const { moduleId, category: c } = await this.find(category);
        return c ? this.api.values(moduleId, c.id) : [];
    }

    async create(category: string, value: string) {
        const { moduleId, category: c } = await this.need(category);
        return this.api.createValue(moduleId, c.id, value);
    }

    async update(category: string, valueId: number, value: string) {
        const { moduleId, category: c } = await this.need(category);
        return this.api.updateValue(moduleId, c.id, valueId, value);
    }

    async delete(category: string, valueId: number) {
        const { moduleId, category: c } = await this.need(category);
        await this.api.deleteValue(moduleId, c.id, valueId);
    }
}
