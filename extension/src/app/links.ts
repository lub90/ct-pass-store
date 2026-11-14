/**
 * Links of „Über“ (spec 4.9), built only from these constants and the extension's version. A release version
 * (`x.y.z`, versioning.md section 2) links to its tag `extension-vx.y.z`; anything else (a development build with
 * `+sha`, or a version that doesn't look like one) links to `main`, so no unchecked text ever ends up in a URL.
 */
export const REPOSITORY = 'https://github.com/lub90/ct-pass-store';

const RELEASE = /^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/;

const tagOf = (version: string): string | null => (RELEASE.test(version) ? `extension-v${version}` : null);
const ref = (version: string): string => tagOf(version) ?? 'main';

/** The user guide as it was at this version. */
export const guideUrl = (version: string): string => `${REPOSITORY}/blob/${ref(version)}/extension/docs/user-guide.md`;

/** `LICENSE` at this version. */
export const licenseUrl = (version: string): string => `${REPOSITORY}/blob/${ref(version)}/LICENSE`;

/** The release notes of this version; for a development build, the CHANGELOG on `main`. */
export function releaseUrl(version: string): string {
    const tag = tagOf(version);
    return tag ? `${REPOSITORY}/releases/tag/${tag}` : `${REPOSITORY}/blob/main/extension/CHANGELOG.md`;
}
