import { CtSetupStep } from '../CtSetupStep';
import { Precondition } from '../Precondition';
import { Permissions } from '../../api/Permissions';
import { AppConfig } from '../../AppConfig';

export class InitializeKeyValueStoreStep extends CtSetupStep {
  
    protected readonly permissions: Permissions;

    public constructor(churchtoolsClient : any) {
        super(churchtoolsClient);

        this.permissions = new Permissions(this.churchtoolsClient);
    }

    async checkPrecondition(): Promise<Precondition[]> {

        const results: Precondition[] = [];

        try {

            // Check rights management (administer person)
            const rights = await this.permissions.canAdministerPersons();
            results.push({
                fulfilled: rights,
                description: rights ? 'Access to rights management system confirmed.' : 'Setup requires access to the rights management system, but you are not authorized.',
            });
        
        

            // Check can generate new cateogries
            const newCategories = await this.permissions.canCreateCustomCategory()
            results.push({
                    fulfilled: newCategories,
                    description: newCategories ? 'Permission to generate new categories confirmed.' : 'Setup requires permission to generate new categories, but you are not authorized.',
                });


        } catch (error) {
        
            results.push({
                fulfilled: false,
                description: "Error occured while checking the permissions: " + error,
            });

            console.error('Permission check failed:', error);
        }

        return results;
    }



    async isCompleted(): Promise<boolean> {

        return (await this.extensionData.hasCategory(AppConfig.SETTINGS_CATEGORY))
            && (await this.extensionData.hasCategory(AppConfig.PASSWORD_STORE_CATEGORY));
    }

    async createSettings(container: HTMLElement): Promise<void> {
        const statusBox = document.createElement('div');
        statusBox.classList.add('alert', 'alert-info', 'd-flex', 'align-items-center', 'gap-2', 'py-2', 'px-3', 'mb-3');
        container.appendChild(statusBox);

        const updateStatus = (icon: string, message: string, type: 'info' | 'success' | 'danger' = 'info') => {
            statusBox.className = `alert alert-${type} d-flex align-items-center gap-2 py-2 px-3 mb-3`;
            statusBox.innerHTML = `<i class="bi ${icon} fs-5"></i><span><strong>${message}</strong></span>`;
        };

        try {
            // Generate settings if not done yet...
            if (!
                (await this.extensionData.hasCategory(AppConfig.SETTINGS_CATEGORY))
            ) {
                updateStatus('bi-hourglass-split text-primary', 'Creating settings...');

                
                await this.extensionData.createCategory(
                    AppConfig.SETTINGS_CATEGORY,
                    AppConfig.SETTINGS_CATEGORY_SHORTY,
                    AppConfig.SETTINGS_SCHEMA,
                    'Stores extension settings'
                );

                updateStatus('bi-check-circle-fill text-success', 'Settings created successfully.', 'success');
            }

        } catch (error) {
            updateStatus('bi-x-circle-fill text-danger', 'Failed to create settings. See console for details.', 'danger');
            console.error('Creation of settings failed:', error);
        }
    }

    async createPwdStore(container: HTMLElement): Promise<void> {
        const statusBox = document.createElement('div');
        statusBox.classList.add('alert', 'alert-info', 'd-flex', 'align-items-center', 'gap-2', 'py-2', 'px-3', 'mb-3');
        container.appendChild(statusBox);

        const updateStatus = (icon: string, message: string, type: 'info' | 'success' | 'danger' = 'info') => {
            statusBox.className = `alert alert-${type} d-flex align-items-center gap-2 py-2 px-3 mb-3`;
            statusBox.innerHTML = `<i class="bi ${icon} fs-5"></i><span><strong>${message}</strong></span>`;
        };

        try {

            // Generate password store if not done yet
            if (!
                (await this.extensionData.hasCategory(AppConfig.PASSWORD_STORE_CATEGORY))
            ) {
                updateStatus('bi-hourglass-split text-primary', 'Creating password store ...');

                await this.extensionData.createCategory(
                    AppConfig.PASSWORD_STORE_CATEGORY,
                    AppConfig.PASSWORD_STORE_CATEGORY_SHORTY,
                    AppConfig.PASSWORD_STORE_SCHEMA,
                    'Stores encrypted credentials'
                );

                updateStatus('bi-check-circle-fill text-success', 'Password store created successfully.', 'success');
            }
        } catch (error) {
            updateStatus('bi-x-circle-fill text-danger', 'Failed to create password store. See console for details.', 'danger');
            console.error('Creation of password store failed:', error);
        }
    }

    async run(container: HTMLElement): Promise<void> {
        await this.createSettings(container);
        await this.createPwdStore(container);
    }

}
