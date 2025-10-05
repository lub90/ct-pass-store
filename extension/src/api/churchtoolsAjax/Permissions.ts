import {AppConfig} from '../../AppConfig'

export class Permissions {

  private readonly churchtoolsClient : any;
  private csrfToken: string | null = null;

  constructor(churchtoolsClient: any) {
    this.churchtoolsClient = churchtoolsClient;
  }

  private async ensureCsrfToken(): Promise<void> {
    if (this.csrfToken) return;

    try {
      const response = await this.churchtoolsClient.get('/csrftoken');
      this.csrfToken = response;
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
      throw error;
    }
  }

  async fetchUserPermissions(): Promise<any> {
    await this.ensureCsrfToken();

    const url = '/../index.php?q=churchauth/ajax';
    const body = { func: 'getMasterData' };

    try {
      const response = await this.churchtoolsClient.post(url, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'CSRF-Token': this.csrfToken!,
        }
      });

      const data = await response;

      // Validate presence of auth_table
      if (!data || typeof data !== 'object' || !data.hasOwnProperty(AppConfig.PERMISSIONS_AUTH_TABLE)) {
        throw new Error(`Missing '${AppConfig.PERMISSIONS_AUTH_TABLE}' in response`);
     }

      const authTable = data[AppConfig.PERMISSIONS_AUTH_TABLE];

      // Validate plugin ID presence
      if (!authTable.hasOwnProperty(AppConfig.EXTENSION_ID)) {
        throw new Error(`Extension ID '${AppConfig.EXTENSION_ID}' not found in '${AppConfig.PERMISSIONS_AUTH_TABLE}'`);
      }

      // Return plugin-specific permissions
      return authTable[AppConfig.EXTENSION_ID];

    } catch (error) {
      console.error('Failed to fetch user permissions:', error);
      throw error;
    }
  }
}
