export class ExtensionData {
    private moduleId: number | null;
    private categories: any[] | null;
    private readonly churchtoolsClient: any;
    private readonly extensionKey: string;

    constructor(churchtoolsClient: any, extensionKey: string) {
    this.churchtoolsClient = churchtoolsClient;
    this.extensionKey = extensionKey;
    this.moduleId = null;
    this.categories = null;
    }

    private async resolveModuleId(): Promise<number> {
        if (this.moduleId !== null) return this.moduleId;

        try {
            const response = await this.churchtoolsClient.get(`/custommodules/${this.extensionKey}`);
            this.moduleId = response.id;
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
            this.categories = response;
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

    async createCategory(fullName: string, shortName: string, schema: string, description?: string): Promise<any> {
        const moduleId = await this.resolveModuleId();

        const body = {
            customModuleId: moduleId,
            name: fullName,
            shorty: shortName,
            schema,
            securityLevelId: '1',
            description: description ?? '',
        };

        try {
            const response = await this.churchtoolsClient.post(
            `/custommodules/${moduleId}/customdatacategories`,
            body
            );
            return response.data;
        } catch (error) {
            console.error(`Failed to create category "${fullName}":`, error);
            throw error;
        }
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
