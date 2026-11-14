/** Types of `sanitize-fixture.js` for the TypeScript contract tests. */
export function sanitizeFixture<T>(value: T, options: { host: string }): T;
/** Keys whose value is a secret (also used by the contract tests' `redactBody`). */
export const SECRET_KEY: RegExp;
