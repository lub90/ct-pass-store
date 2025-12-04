import type { SetupStep } from "../types/SetupStep";
import type { Component } from "vue";


export class CtSetupStep implements SetupStep {

    public component: Component;

    public constructor(component: Component) {
        this.component = component;
    }

    public allowBack(): boolean {
        return true;
    }

    public allowRetry(): boolean {
        return false;
    }
}