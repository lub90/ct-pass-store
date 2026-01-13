import type { GlobalPermissions } from '../types/ct-types.ts';

export class Permissions {

  private readonly churchtoolsClient: any
  private readonly extensionKey: string
  private globalPermissions: GlobalPermissions | null;

  constructor(churchtoolsClient: any, extensionKey: string) {
    this.churchtoolsClient = churchtoolsClient;
    this.extensionKey = extensionKey;
    this.globalPermissions = null;
  }

  async fetchGlobalPermissions(): Promise<GlobalPermissions> {
    if (this.globalPermissions) {
        return this.globalPermissions;
    }

    try {

      this.globalPermissions = await this.churchtoolsClient.get('/permissions/global');
      return this.globalPermissions!;

    } catch (error) {

      console.error('Failed to fetch global permissions:', error);
      throw error;

    }
  }

  async getExtensionPermissions(): Promise<Record<string, any>> {
    const all = await this.fetchGlobalPermissions();
    return all[this.extensionKey] ?? {};
  }

  async canView(): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return perms['view'] === true;
  }

  async canCreateCustomCategory(): Promise<boolean> {
    const perms = await this.getExtensionPermissions();
    return perms['create custom category'] === true;
  }

  async canViewCustomData(): Promise<boolean> {
    return this.hasArrayPermission(await this.getExtensionPermissions(), 'view custom data');
  }

  async canEditCustomData(): Promise<boolean> {
    return this.hasArrayPermission(await this.getExtensionPermissions(), 'edit custom data');
  }

  async canDeleteCustomCategory(): Promise<boolean> {
    return this.hasArrayPermission(await this.getExtensionPermissions(), 'delete custom category');
  }

  async canAdministerPersons(): Promise<boolean> {
    const all = await this.fetchGlobalPermissions();
    return all['churchcore']?.['administer persons'] === true;
  }

  async canViewCustomDataForCategory(categoryId: number): Promise<boolean> {
    return this.hasArrayPermission(await this.getExtensionPermissions(), 'view custom data', categoryId);
  }

  async canCreateCustomDataForCategory(categoryId: number): Promise<boolean> {
    return this.hasArrayPermission(await this.getExtensionPermissions(), 'create custom data', categoryId);
  }

  async canEditCustomDataForCategory(categoryId: number): Promise<boolean> {
    return this.hasArrayPermission(await this.getExtensionPermissions(), 'edit custom data', categoryId);
  }

  async canDeleteCustomDataForCategory(categoryId: number): Promise<boolean> {
    return this.hasArrayPermission(await this.getExtensionPermissions(), 'delete custom data', categoryId);
  }


  private hasArrayPermission(
    perms: Record<string, any>,
    key: string,
    categoryId?: number
  ): boolean {
    const value = perms[key];
    if (!Array.isArray(value)) return false;
    return categoryId !== undefined ? value.includes(categoryId) : value.length > 0;
  }


}
