import type { Component } from "vue";
import { Precondition } from "../types/Precondition";
import type { SetupStep } from "../types/SetupStep";
import Step1Component from "./Step1Component.vue";


export class Step1 implements SetupStep {

    component: Component = Step1Component;

    checkPrecondition(): Promise<Precondition[]> {
        return new Promise(resolve => {
            setTimeout(() => {
            resolve([
                new Precondition('Step 1 must be completed manually.', false),
            ]);
            }, 3000); // 3 seconds delay
        });
    }

}