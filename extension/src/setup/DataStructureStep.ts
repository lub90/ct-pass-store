
import type { Component } from "vue";
import { Precondition } from "../types/Precondition";
import type { SetupStep } from "../types/SetupStep";
import DataStructureStepComponent from "./DataStructureStepComponent.vue";
import { Permissions } from "../api/Permissions";
import { AppConfig } from "../AppConfig";
import { ExtensionData } from "../api/ExtensionData";


export class DataStructureStep implements SetupStep {

    private churchtoolsClient : any;

    public constructor(churchtoolsClient : any) {
        this.churchtoolsClient = churchtoolsClient;
    }

    component: Component = DataStructureStepComponent;

    async checkPrecondition(): Promise<Precondition[]> {

        const results: Precondition[] = [];

        try {

            const permissions = new Permissions(this.churchtoolsClient);

            // Check rights management (administer person)
            const rights = await permissions.canAdministerPersons();
            results.push({
                fulfilled: rights,
                description: rights ? 'Access to rights management system confirmed.' : 'Setup requires access to the rights management system, but you are not authorized.',
            });
        
        

            // Check can generate new cateogries
            const newCategories = await permissions.canCreateCustomCategory()
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


    