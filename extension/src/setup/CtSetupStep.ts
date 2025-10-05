import type { Precondition } from "./Precondition";
import type { SetupStep } from "./SetupStep";


export abstract class CtSetupStep implements SetupStep {

    protected readonly churchtoolsClient: any;

    constructor(churchtoolsClient: any) {
        this.churchtoolsClient = churchtoolsClient;
    }

    abstract checkPrecondition(): Promise<Precondition[]>; 

    abstract isCompleted(): Promise<boolean>;

    abstract run(container: HTMLElement): Promise<void>;

}

