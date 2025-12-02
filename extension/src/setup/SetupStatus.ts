import type { ExtensionData } from "../api/ExtensionData";
import { AppConfig } from "../AppConfig";

export async function setupCompleted(extensionData: ExtensionData): Promise<boolean> {

    // Step 1: Check if any categories exist
    const hasCategories = await extensionData.hasCategory(AppConfig.SETUP_COMPLETED_CATEGORY);
    if (!hasCategories) {
        console.info('Settings category not found — setup has not started.');
        return false;
    }

    // Step 3: Check if categories contain settings data
    const setupHasData = await extensionData.categoryHasData(AppConfig.SETUP_COMPLETED_CATEGORY);
    if (!setupHasData) {
        console.info('Settings category exists but contains no data — setup incomplete.');
        return false;
    }

    try {
        const setupFinishedRaw = await extensionData.getCategoryData(
            AppConfig.SETUP_COMPLETED_CATEGORY,
            true
        );
        const parsedValue = JSON.parse(setupFinishedRaw.value);
        return parsedValue.setupCompleted;
    } catch (err) {
        // If anything went wrong by reading the values, the setup has not set its completed flag.
        return false;
    }
}