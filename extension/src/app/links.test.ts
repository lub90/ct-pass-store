import { describe, expect, it } from 'vitest';
import { guideUrl, licenseUrl, releaseUrl, REPOSITORY } from './links';

describe('versioned links', () => {
    it('point to the tag of a clean version', () => {
        expect(REPOSITORY).toBe('https://github.com/lub90/ct-pass-store');
        expect(guideUrl('0.1.0')).toBe('https://github.com/lub90/ct-pass-store/blob/extension-v0.1.0/extension/docs/user-guide.md');
        expect(guideUrl('0.1.0')).toContain('/blob/extension-v0.1.0/');
        expect(licenseUrl('12.30.4')).toBe('https://github.com/lub90/ct-pass-store/blob/extension-v12.30.4/LICENSE');
        expect(releaseUrl('0.1.0')).toBe('https://github.com/lub90/ct-pass-store/releases/tag/extension-v0.1.0');
    });

    it.each(['0.1.0+abc', '0.1.0+abc-dirty', '0.1.0+unknown'])('point to main for the development build %s', (version) => {
        expect(guideUrl(version)).toBe('https://github.com/lub90/ct-pass-store/blob/main/extension/docs/user-guide.md');
        expect(guideUrl(version)).toContain('/blob/main/');
        expect(licenseUrl(version)).toBe('https://github.com/lub90/ct-pass-store/blob/main/LICENSE');
        expect(releaseUrl(version)).toBe('https://github.com/lub90/ct-pass-store/blob/main/extension/CHANGELOG.md');
    });

    it.each(['', '0.1', '01.0.0', '0.1.0-rc.1', '0.1.0/../../x', '../../evil', '0.1.0?x', '0.1.0#x', ' 0.1.0', '0.1.0\n', '1.2.3.4', 'v0.1.0'])(
        'never put the malformed version %j into a URL',
        (version) => {
            for (const url of [guideUrl(version), licenseUrl(version), releaseUrl(version)]) {
                expect(url.startsWith('https://github.com/lub90/ct-pass-store/blob/main/')).toBe(true);
                if (version !== '') expect(url).not.toContain(version);
            }
        },
    );
});
