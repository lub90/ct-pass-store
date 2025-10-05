import type { Precondition } from "./Precondition";
import type { SetupStep } from "./SetupStep";
import { ExtensionData } from '../api/ExtensionData';
import { AppConfig } from "../AppConfig";


export abstract class CtSetupStep implements SetupStep {

    protected readonly churchtoolsClient: any;
    protected readonly extensionData: ExtensionData;

    constructor(churchtoolsClient: any) {
        this.churchtoolsClient = churchtoolsClient;
        this.extensionData = new ExtensionData(this.churchtoolsClient, AppConfig.EXTENSION_KEY);
    }

    abstract checkPrecondition(): Promise<Precondition[]>; 

    abstract isCompleted(): Promise<boolean>;

    abstract run(container: HTMLElement): Promise<void>;

}

