
import type { Component } from "vue";
import { Precondition } from "../types/Precondition";
import type { SetupStep } from "../types/SetupStep";
import DataStructureStepComponent from "./DataStructureStepComponent.vue";
import { ExtensionData } from "../api/ExtensionData";
import { CtSetupStep } from "./CtSetupStep";


export class DataStructureStep extends CtSetupStep {

    component: Component = DataStructureStepComponent;

    async checkPrecondition(): Promise<Precondition[]> {
        // TODO: We cannot check anything here because the data categories do not exist yet!
        return [];
    }

}


    