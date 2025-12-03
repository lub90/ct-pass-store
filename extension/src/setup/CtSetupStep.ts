import type { SetupStep } from "../types/SetupStep";
import { Permissions } from "../api/Permissions";


export abstract class CtSetupStep implements SetupStep {

    protected churchtoolsClient : any;
    protected permissions: Permissions;


    public constructor(churchtoolsClient : any) {
        this.churchtoolsClient = churchtoolsClient;
        this.permissions = new Permissions(this.churchtoolsClient);
    }

    public allowBack(): boolean {
        return true;
    }

    public allowRetry(): boolean {
        return false;
    }
}