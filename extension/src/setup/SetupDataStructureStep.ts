
import type { Component } from "vue";
import { Precondition } from "../types/Precondition";
import type { SetupStep } from "../types/SetupStep";
import SetupDataStructureStepComponent from "./SetupDataStructureStepComponent.vue";
import { ExtensionData } from "../api/ExtensionData";
import { CtSetupStep } from "./CtSetupStep";


export class SetupDataStructureStep extends CtSetupStep {

    component: Component = SetupDataStructureStepComponent;

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


}


    