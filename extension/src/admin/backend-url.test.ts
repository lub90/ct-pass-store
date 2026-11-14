import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '../model/schemas';
import * as v from 'valibot';
import { normalizeBackendUrl } from './backend-url';

describe('backend url rules', () => {
    it.each([
        ['https://a.example/', 'https://a.example'],
        ['https://a.example', 'https://a.example'],
        ['https://a.example//', 'https://a.example'],
        ['https://a.example/api/', 'https://a.example/api'],
        ['https://a.example:8443/pw', 'https://a.example:8443/pw'],
        // '@' outside the host is no credentials (parse_url agrees).
        ['https://a.example/p@x', 'https://a.example/p@x'],
        // The host as the browser uses it: case doesn't matter, an IDN in its xn-- form is fine.
        ['https://A.Example/x', 'https://A.Example/x'],
        ['https://xn--bcher-kva.example', 'https://xn--bcher-kva.example'],
        ['https://a.example:443', 'https://a.example:443'],
        ['https://[::1]:8443', 'https://[::1]:8443'],
    ])('%s → %s', (input, url) => {
        expect(normalizeBackendUrl(input)).toStrictEqual({ ok: true, url });
    });

    it.each([
        ['http://a.example', 'not-https'],
        ['HTTPS://a.example', 'not-https'],
        ['javascript:alert(1)', 'not-https'],
        ['a.example', 'not-https'],
        ['https://user@a.example', 'credentials'],
        ['https://user:pw@a.example', 'credentials'],
        ['https://:@a.example', 'credentials'],
        ['https://a.example?x', 'query'],
        ['https://a.example/?', 'query'],
        ['https://a.example#y', 'fragment'],
        ['https://a.example/#', 'fragment'],
        ['', 'invalid'],
        ['https://', 'invalid'],
        ['https:///a.example', 'invalid'],
        [' https://a.example', 'invalid'],
        ['https://a.example ', 'invalid'],
        ['https://a.example/ ', 'invalid'],
        ['https://a .example', 'invalid'],
        ['https://a.example\n', 'invalid'],
        ['https://a.example\\@evil.example', 'invalid'],
        ['https://a.example:99999', 'invalid'],
        ['https://a\u200B.example', 'invisible'],
        ['https://a.example/\u202E', 'invisible'],
        ['https://a.example/\u2066x\u2069', 'invisible'],
        ['https://a.example/\uFEFF', 'invalid'],
        ['https://a.example/\u00AD', 'invisible'],
        ['https://a.example?u@x', 'query'],
        // Control characters that aren't whitespace (the URL parser would percent-encode them in a path).
        ['https://a.example/\u0000', 'invalid'],
        ['https://a.example/\u0001', 'invalid'],
        ['https://a.example/\u001B', 'invalid'],
        ['https://a\u0001.example', 'invalid'],
        ['https://a\u001B.example', 'invalid'],
        ['https://a.example/\u007F', 'invalid'],
        // F1: the host the browser connects to must be the host shown.
        ['https://good.example%2eevil.com', 'host-encoding'],
        ['https://good%2Eexample', 'host-encoding'],
        ['https://\uFF47ood.example', 'host-encoding'],
        ['https://g\u043E\u043Ed.example', 'host-encoding'],
        ['https://b\u00FCcher.example', 'host-encoding'],
        ['https://0x7f.0.0.1', 'host-encoding'],
        ['https://2130706433', 'host-encoding'],
    ])('%j is refused: %s', (input, reason) => {
        expect(normalizeBackendUrl(input)).toStrictEqual({ ok: false, reason });
    });

    it('accepts exactly what the store accepts (same check, after the slash is removed)', () => {
        const base = { schema: 2, revision: 1, requirePasswordForPasswordChange: false, allowCustomPassword: true, passwordLength: 16 };
        for (const input of ['https://a.example/', 'https://a.example/x', 'http://a.example', 'https://u@a.example', 'https://a.example?x', 'https:///x', 'https://:@a']) {
            const result = normalizeBackendUrl(input);
            const stored = v.safeParse(SettingsSchema, { ...base, backendUrl: result.ok ? result.url : input }).success;
            expect(stored, input).toBe(result.ok);
        }
    });
});
