/** `x.y.z`, optionally with build metadata `+…` (versioning.md section 1). */
const VERSION = /^(\d+)\.(\d+)\.\d+(?:\+.*)?$/;

/**
 * Whether two versions share `MAJOR.MINOR` (versioning.md section 3). Build metadata (`+sha`, `-dirty`) is ignored. A
 * malformed version never matches, so the app falls back to `version-mismatch` rather than a role.
 */
export function sameMajorMinor(a: string, b: string): boolean {
    const x = VERSION.exec(a);
    const y = VERSION.exec(b);
    if (!x || !y) return false;
    return Number(x[1]) === Number(y[1]) && Number(x[2]) === Number(y[2]);
}
