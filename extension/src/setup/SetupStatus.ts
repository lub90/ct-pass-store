import type { ExtensionData } from "../api/ExtensionData";
import { AppConfig } from "../AppConfig";

export async function setupCompleted(extensionData: ExtensionData): Promise<boolean> {

    try {
        // Check if we have a setup completed category and whether the value is set to true
        const setupFinishedRaw = await extensionData.getCategoryData(
            AppConfig.SETUP_COMPLETED_CATEGORY,
            true
        );
        const parsedValue = JSON.parse(setupFinishedRaw.value);
        return parsedValue.setupCompleted;
    } catch (err) {
        // If anything went wrong by reading the values, the setup has not set its completed flag.
        console.info(`Category "${AppConfig.SETUP_COMPLETED_CATEGORY}" does not exist!`)
        return false;
    }
}