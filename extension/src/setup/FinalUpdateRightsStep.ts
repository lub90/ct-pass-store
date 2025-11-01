
import type { Component } from "vue";
import { Precondition } from "../types/Precondition";
import type { SetupStep } from "../types/SetupStep";
import FinalUpdateRightsStepComponent from "./FinalUpdateRightsStepComponent.vue";
import { ExtensionData } from "../api/ExtensionData";
import { CtSetupStep } from "./CtSetupStep";


export class FinalUpdateRightsStep extends CtSetupStep {

    component: Component = FinalUpdateRightsStepComponent;

    async checkPrecondition(): Promise<Precondition[]> {
        // TODO: We cannot check anything here because the data categories do not exist yet!
        return [];
    }
}


    