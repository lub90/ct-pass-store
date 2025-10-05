export class ExtensionData {
    private moduleId: number | null;
    private categories: any[];
    private readonly churchtoolsClient: any;
    private readonly extensionKey: string;

    constructor(churchtoolsClient: any, extensionKey: string) {
    this.churchtoolsClient = churchtoolsClient;
    this.extensionKey = extensionKey;
    this.moduleId = null;
    this.categories = [];
    }

    private async resolveModuleId(): Promise<number> {
        if (this.moduleId !== null) return this.moduleId;

        try {
            const response = await this.churchtoolsClient.get(`/custommodules/${this.extensionKey}`);
            this.moduleId = response.data?.id;
            return this.moduleId!;
        } catch (error) {
            console.error('Failed to resolve module ID:', error);
            throw error;
        }
    }

    private async fetchCategories(): Promise<any[]> {
        if (this.categories) {
            return this.categories;
        }

        const moduleId = await this.resolveModuleId();

        try {
            const response = await this.churchtoolsClient.get(`/custommodules/${moduleId}/customdatacategories`);
            this.categories = response.data?.data ?? [];
            return this.categories;
        } catch (error) {
            console.error('Failed to fetch categories:', error);
            throw error;
        }
    }

    async hasAnyCategories(): Promise<boolean> {
        const categories = await this.fetchCategories();
        return categories.length > 0;
    }

    async hasCategory(name: string): Promise<boolean> {
        const categories = await this.fetchCategories();
        return categories.some(c => c.name === name);
    }

    async categoryHasData(name: string): Promise<boolean> {
        const categories = await this.fetchCategories();
        const category = categories.find(c => c.name === name);
        if (!category) {
            return false;
        }

        try {
            const response = await this.churchtoolsClient.get(
            `/custommodules/${category.customModuleId}/customdatacategories/${category.id}/customdatavalues`
            );
            const values = response.data?.data ?? [];
            return values.length > 0;
        } catch (error) {
            console.error(`Failed to fetch data for category "${name}":`, error);
            throw error;
        }
    }
}
