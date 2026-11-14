import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, base64url, challengeFor, createPkce, randomToken } from './pkce';

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;
const nodeChallenge = (verifier: string) => createHash('sha256').update(verifier, 'ascii').digest('base64url');

afterEach(() => vi.restoreAllMocks());

describe('base64url', () => {
    it('uses - and _ and no padding', () => {
        expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
        expect(base64url(new Uint8Array([0xff]))).toBe('_w');
        expect(base64url(new Uint8Array([0xff, 0xff]))).toBe('__8');
        expect(base64url(new Uint8Array([]))).toBe('');
    });
});

describe('randomToken', () => {
    it('draws 32 bytes from crypto.getRandomValues (256 bits, 43 characters)', () => {
        const spy = vi.spyOn(crypto, 'getRandomValues');
        const token = randomToken();
        expect(spy).toHaveBeenCalledTimes(1);
        expect((spy.mock.calls[0]![0] as Uint8Array).length).toBe(32);
        expect(token).toHaveLength(43);
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('is the base64url of the random bytes', () => {
        vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
            (array as unknown as Uint8Array).fill(0xff);
            return array;
        });
        expect(randomToken()).toBe('_'.repeat(42) + '8');
    });

    it('differs between calls', () => {
        expect(randomToken()).not.toBe(randomToken());
    });
});

describe('challengeFor', () => {
    it('is base64url(SHA-256(verifier)) without padding', async () => {
        for (const verifier of ['a'.repeat(43), 'Az09-._~'.repeat(16), randomToken()]) {
            const challenge = await challengeFor(verifier);
            expect(challenge).toBe(nodeChallenge(verifier));
            expect(challenge).toHaveLength(43);
            expect(challenge).not.toContain('=');
        }
    });
});

describe('createPkce', () => {
    it('makes a 43 to 128 character verifier from the unreserved set and its S256 challenge', async () => {
        const { verifier, challenge } = await createPkce();
        expect(verifier.length).toBeGreaterThanOrEqual(43);
        expect(verifier.length).toBeLessThanOrEqual(128);
        expect(verifier).toMatch(UNRESERVED);
        expect(challenge).toBe(nodeChallenge(verifier));
    });

    it('makes a new verifier each time', async () => {
        const a = await createPkce();
        const b = await createPkce();
        expect(a.verifier).not.toBe(b.verifier);
        expect(a.challenge).not.toBe(b.challenge);
    });
});

describe('authorizeUrl', () => {
    it('asks ChurchTools for a code with scope api and an S256 challenge', () => {
        const url = new URL(authorizeUrl('https://ct.example.org', 'client-1', 'https://ct.example.org/ccm/ctpassstore/auth/callback', 'st', 'ch'));
        expect(url.origin + url.pathname).toBe('https://ct.example.org/oauth/authorize');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: 'client-1',
            redirect_uri: 'https://ct.example.org/ccm/ctpassstore/auth/callback',
            response_type: 'code',
            scope: 'api',
            state: 'st',
            code_challenge: 'ch',
            code_challenge_method: 'S256',
        });
    });

    it('uses only the origin of a base URL with a path or trailing slash', () => {
        expect(authorizeUrl('https://ct.example.org/', 'c', 'r', 's', 'x')).toMatch(/^https:\/\/ct\.example\.org\/oauth\/authorize\?/);
        expect(authorizeUrl('https://ct.example.org/some/path/', 'c', 'r', 's', 'x')).toMatch(/^https:\/\/ct\.example\.org\/oauth\/authorize\?/);
    });

    it('encodes the client id so it cannot add parameters', () => {
        const url = new URL(authorizeUrl('https://ct.example.org', 'a&scope=all#x', 'r', 's', 'x'));
        expect(url.searchParams.get('client_id')).toBe('a&scope=all#x');
        expect(url.searchParams.getAll('scope')).toEqual(['api']);
        expect(url.hash).toBe('');
    });
});
