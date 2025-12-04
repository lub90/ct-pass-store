
import type { Component } from "vue";
import TestBackendComponent from "./TestBackendComponent.vue";
import { CtSetupStep } from "./CtSetupStep";


export class TestBackend extends CtSetupStep {

    component: Component = TestBackendComponent;

}


    