
import type { Component } from "vue";
import { Precondition } from "../types/Precondition";
import type { SetupStep } from "../types/SetupStep";
import SettingsSetupStepComponent from "./SettingsSetupStepComponent.vue";
import { ExtensionData } from "../api/ExtensionData";
import { CtSetupStep } from "./CtSetupStep";


export class SettingsSetupStep extends CtSetupStep {

    component: Component = SettingsSetupStepComponent;

    async checkPrecondition(): Promise<Precondition[]> {
        // TODO: We cannot check anything here because the data categories do not exist yet!
        return [];
    }
}


    