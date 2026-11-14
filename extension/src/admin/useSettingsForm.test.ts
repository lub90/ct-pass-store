import { describe, expect, it } from 'vitest';
import { CtForbiddenError, CtHttpError, CtRateLimitedError, NotAuthenticatedError } from '../ct/errors';
import { CategoryMissingError, InvalidValueError, ValueTooLargeError } from '../model/errors';
import { settingsErrorText } from './useSettingsForm';

describe('settingsErrorText', () => {
    it.each([
        ['a missing right (named)', new CtForbiddenError('x', 'create custom data'), { key: 'settings.missingRight', params: { right: 'create custom data', category: 'settings' } }],
        ['a missing right (unnamed)', new CtForbiddenError(), { key: 'settings.missingRight', params: { right: 'edit custom data', category: 'settings' } }],
        ['the rate limit', new CtRateLimitedError(150_000), { key: 'state.ctRateLimited', params: { n: 3 } }],
        ['logged out', new NotAuthenticatedError(), { key: 'manage.ctLoggedOut', params: {} }],
        ['too large', new ValueTooLargeError(10_500, 10_000), { key: 'settings.tooLarge', params: { size: 10_500, limit: 10_000 } }],
        ['an invalid value', new InvalidValueError(['x']), { key: 'settings.notSaved', params: {} }],
        ['a missing category', new CategoryMissingError('settings'), { key: 'settings.categoryMissing', params: {} }],
        ['anything else', new CtHttpError(500), { key: 'state.ctUnavailable', params: {} }],
    ])('%s', (_n, error, expected) => {
        expect(settingsErrorText(error)).toStrictEqual(expected);
    });
});
