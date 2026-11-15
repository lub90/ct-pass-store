/** True for the old data layout (spec 6.3): an unversioned `settings` value with old fields, or a `setupCompleted` category. */
export function isOldLayout(settingsRaw: unknown, categoryNames: string[]): boolean {
    if (categoryNames.includes('setupCompleted')) return true;
    if (typeof settingsRaw !== 'object' || settingsRaw === null || Array.isArray(settingsRaw)) return false;
    const o = settingsRaw as Record<string, unknown>;
    return !('schema' in o) && ('adminUsers' in o || 'readAccessUsers' in o);
}
