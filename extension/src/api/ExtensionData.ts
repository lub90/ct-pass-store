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
            if (this.categories === null) {
                return []
            } else {
                return this.categories;
            }
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

    async createCategory(fullName: string, shortName: string, schemaDefinition: string, description?: string): Promise<any> {
        const moduleId = await this.resolveModuleId();

        const body = {
            customModuleId: moduleId,
            name: fullName,
            shorty: shortName,
            schema: schemaDefinition,
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
        const category: any = await this.getCategoryByName(name);   

        try {
            const response = await this.churchtoolsClient.get(
            `/custommodules/${category.customModuleId}/customdatacategories/${category.id}/customdatavalues`
            );

            return (response !== undefined) && (response.length > 0);
        } catch (error) {
            console.error(`Failed to fetch data for category "${name}":`, error);
            throw error;
        }
    }

    async categoryExists(name: string) : Promise<boolean> {
        try {
            // We try to get this category
            await this.getCategoryByName(name);
        } catch (error) {
            // Error dindicates that the category does not exists, or is not visible to us
            return false;
        }
        return true;
    }

    async getCategoryByName(name: string) : Promise<any> {
        const categories = await this.fetchCategories();
        const category = categories.find(c => c.name === name);
        if (!category) {
            throw new Error(`Category "${name}" not found.`);
        }
        return category;
    }

    async getCategoryData(name: string, single = false): Promise<any[] | any> {
        const category: any = await this.getCategoryByName(name);        

        try {
            const response = await this.churchtoolsClient.get(
                `/custommodules/${category.customModuleId}/customdatacategories/${category.id}/customdatavalues`
            );
            const values = response ?? [];

            if (single) {
                if (values.length !== 1) {
                    throw new Error(`Expected exactly one entry in category "${name}", but found ${values.length}.`);
                }
                return values[0];
            }

            return values;
        } catch (error) {
            throw error;
        }
    }

    async deleteCategoryEntry(name: string, valueId: number): Promise<void> {
        const category: any = await this.getCategoryByName(name); 

        const moduleId = await this.resolveModuleId();

        try {
            await this.churchtoolsClient.deleteApi(
                `/custommodules/${moduleId}/customdatacategories/${category.id}/customdatavalues/${valueId}`
            );
        } catch (error) {
            console.error(`Failed to delete entry ${valueId} in category "${name}":`, error);
            throw error;
        }
    }

    async createCategoryEntry(name: string, data: object): Promise<number> {
        const moduleId = await this.resolveModuleId();
        const category: any = await this.getCategoryByName(name); 

        const payload = {
            dataCategoryId: category.id,
            domainId: '1',
            domainType: 'status',
            value: JSON.stringify(data),
        };

        try {
            const response = await this.churchtoolsClient.post(
                `/custommodules/${moduleId}/customdatacategories/${category.id}/customdatavalues`,
                payload
            );
            return response.data?.id;
        } catch (error) {
            console.error(`Failed to create entry in category "${category.name}":`, error);
            throw error;
        }
    }

    async updateCategoryEntry(name: string, valueId: number, data: object): Promise<number> {
        const moduleId = await this.resolveModuleId();
        const category: any = await this.getCategoryByName(name); 

        const payload = {
            dataCategoryId: category.id,
            id: valueId,
            value: JSON.stringify(data),
        };

        try {
            const response = await this.churchtoolsClient.put(
                `/custommodules/${moduleId}/customdatacategories/${category.id}/customdatavalues/${valueId}`,
                payload
            );
            return response.data?.id;
        } catch (error) {
            console.error(`Failed to update entry ${valueId} in category "${category.name}":`, error);
            throw error;
        }
    }



}
