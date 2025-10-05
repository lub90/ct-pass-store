import { CtSetupStep } from '../CtSetupStep';
import { Precondition } from '../Precondition';
import { Permissions } from '../../api/Permissions';

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
        // Implementation pending
        return false;
    }

    async run(container: HTMLElement): Promise<void> {
        // Implementation pending
    }
}
