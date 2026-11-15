import { describe, expect, it } from 'vitest';
import { isOldLayout } from './layout';

describe('isOldLayout', () => {
    it('is true for adminUsers without schema', () => expect(isOldLayout({ adminUsers: [] }, ['settings'])).toBe(true));
    it('is true for readAccessUsers without schema', () => expect(isOldLayout({ readAccessUsers: [] }, [])).toBe(true));
    it('is true for a setupCompleted category', () => expect(isOldLayout(undefined, ['setupCompleted'])).toBe(true));
    it('is false for a v2 value', () => expect(isOldLayout({ schema: 2, revision: 1, adminUsers: [] }, ['settings', 'access'])).toBe(false));
    it('is false for nothing or junk', () => {
        expect(isOldLayout(undefined, [])).toBe(false);
        expect(isOldLayout(null, [])).toBe(false);
        expect(isOldLayout([], [])).toBe(false);
        expect(isOldLayout({ other: 1 }, [])).toBe(false);
    });
});
