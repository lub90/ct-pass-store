import { describe, expect, it } from 'vitest';
import { tokenPerson } from './jwt';

const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const jwt = (payload: unknown) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2ln`;

describe('tokenPerson', () => {
    it('reads the person id from the decimal string sub of the payload (no signature check)', () => {
        expect(tokenPerson(jwt({ sub: '42', admin: true }))).toBe(42);
        expect(tokenPerson(jwt({ sub: '9007199254740991' }))).toBe(9007199254740991);
    });

    it('reads a payload that needs base64url padding and the - and _ characters', () => {
        // The name makes the payload length need padding and contain bytes that encode to - and _.
        for (const name of ['a', 'ab', 'abc', '~~~???>>>']) expect(tokenPerson(jwt({ sub: '7', name }))).toBe(7);
    });

    it.each([
        ['a number sub', jwt({ sub: 42 })],
        ['no sub', jwt({ admin: true })],
        ['sub 0', jwt({ sub: '0' })],
        ['a negative sub', jwt({ sub: '-1' })],
        ['a leading zero', jwt({ sub: '042' })],
        ['a fraction', jwt({ sub: '4.2' })],
        ['an exponent', jwt({ sub: '4e2' })],
        ['spaces', jwt({ sub: ' 42' })],
        ['beyond safe integers', jwt({ sub: '9007199254740993' })],
        ['an array payload', jwt(['42'])],
        ['a null payload', jwt(null)],
        ['a payload that is not JSON', `${b64('{}')}.${b64('{sub')}.x`],
        ['a payload that is not base64url', 'a.!!!.c'],
        ['two parts', `${b64('{}')}.${b64({ sub: '42' })}`],
        ['four parts', `${b64('{}')}.${b64({ sub: '42' })}.c.d`],
        ['an empty string', ''],
        ['an opaque token', 'fake-token'],
    ])('rejects %s', (_name, token) => {
        expect(tokenPerson(token)).toBeNull();
    });
});
