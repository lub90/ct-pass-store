
import type { Component } from "vue";
import { Precondition } from "../types/Precondition";
import type { SetupStep } from "../types/SetupStep";
import SetupDataStructureStepComponent from "./SetupDataStructureStepComponent.vue";
import { ExtensionData } from "../api/ExtensionData";
import { CtSetupStep } from "./CtSetupStep";


export class SetupDataStructureStep extends CtSetupStep {

    component: Component = SetupDataStructureStepComponent;

    async checkPrecondition(): Promise<Precondition[]> {
        // TODO: We cannot check anything here because the data categories do not exist yet!
        return [];
    }


}


    