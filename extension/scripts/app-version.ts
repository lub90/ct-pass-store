/** Runs a git command in the extension folder and returns its trimmed output; throws on failure. */
export type Git = (args: string) => string;

/**
 * `x.y.z` only when HEAD carries exactly the tag `extension-v<x.y.z>` and the tree is clean,
 * otherwise `x.y.z+sha` (plus `-dirty`), and `x.y.z+unknown` when git is unavailable.
 */
export function appVersion(base: string, git: Git): string {
    try {
        let tagged = false;
        try {
            tagged = git("describe --exact-match --tags --match 'extension-v*' HEAD") === `extension-v${base}`;
        } catch {
            // HEAD carries no extension tag
        }
        const dirty = git('status --porcelain') !== '';
        if (tagged && !dirty) return base;
        return `${base}+${git('rev-parse --short HEAD')}${dirty ? '-dirty' : ''}`;
    } catch {
        return `${base}+unknown`; // no git: never claim a release
    }
}
