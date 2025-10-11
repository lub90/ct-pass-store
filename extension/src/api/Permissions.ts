import type { GlobalPermissions } from '../utils/ct-types.d'
import { AppConfig } from '../AppConfig'

export class Permissions {

    private readonly churchtoolsClient: any
  private globalPermissions: GlobalPermissions | null;

  constructor(churchtoolsClient: any) {
    this.churchtoolsClient = churchtoolsClient;
    this.globalPermissions = null;
  }

  async fetchGlobalPermissions(): Promise<any | null> {
    if (this.globalPermissions) {
        return this.globalPermissions;
    }

    try {

      this.globalPermissions = await this.churchtoolsClient.get<GlobalPermissions>('/permissions/global');
      return this.globalPermissions;

    } catch (error) {

      console.error('Failed to fetch global permissions:', error);
      throw error;

    }
  }

  async getExtensionPermissions(): Promise<Record<string, any>> {
    const all = await this.fetchGlobalPermissions();
    return all[AppConfig.EXTENSION_KEY] ?? {};
  }

  async canCreateCustomCategory(): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return perms['create custom category'] === true;
  }

  async canViewCustomData(): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return Array.isArray(perms['view custom data']) && perms['view custom data'].length > 0;
  }

  async canEditCustomData(): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return Array.isArray(perms['edit custom data']) && perms['edit custom data'].length > 0;
  }

  async canDeleteCustomCategory(): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return Array.isArray(perms['delete custom category']) && perms['delete custom category'].length > 0;
  }

  async canAdministerPersons(): Promise<boolean> {
    const all = await this.fetchGlobalPermissions();
    return all['churchcore']?.['administer persons'] === true;
    }

    async canViewCustomDataForCategory(categoryId: number): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return Array.isArray(perms['view custom data']) && perms['view custom data'].includes(categoryId);
}

async canCreateCustomDataForCategory(categoryId: number): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return Array.isArray(perms['create custom data']) && perms['create custom data'].includes(categoryId);
}

async canEditCustomDataForCategory(categoryId: number): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return Array.isArray(perms['edit custom data']) && perms['edit custom data'].includes(categoryId);
}

async canDeleteCustomDataForCategory(categoryId: number): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return Array.isArray(perms['delete custom data']) && perms['delete custom data'].includes(categoryId);
}

}
