/**
 * The demo marker (spec 13.5, security F4): every module under `src/dev/` puts it into its code, and
 * `scripts/check-dist.js` fails a build that contains it. `markers.test.ts` proves it survives minification.
 */
export const DEMO_MARKER = '__DEMO__';

/** Tags a demo object with the marker (a hidden property), so the marker is in the code wherever the object is made. */
export function tagDemo<T extends object>(value: T): T {
    Object.defineProperty(value, DEMO_MARKER, { value: true });
    return value;
}
