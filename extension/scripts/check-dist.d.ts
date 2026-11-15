/** Types of `check-dist.js` for the TypeScript tests. */
export interface LocalSecret {
    name: string;
    file: string;
    value: string;
}
export function checkDist(dist: string, options?: { demoStrings?: string[]; secrets?: LocalSecret[] }): string[];
export function localSecrets(envDir: string): LocalSecret[];
