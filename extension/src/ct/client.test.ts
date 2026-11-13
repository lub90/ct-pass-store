import { afterEach, describe, expect, it } from 'vitest';
import { createClient, instanceBaseUrl, retryAfterMs } from './client';

describe('retryAfterMs', () => {
    it('reads seconds', () => {
        expect(retryAfterMs({ headers: { 'retry-after': '120' } })).toBe(120_000);
    });

    it('reads an HTTP date', () => {
        const now = Date.parse('2026-11-13T10:00:00Z');
        const at = new Date(now + 300_000).toUTCString();
        expect(retryAfterMs({ headers: { 'Retry-After': at } }, now)).toBe(300_000);
    });

    it('never goes below 60 seconds', () => {
        expect(retryAfterMs({ headers: { 'retry-after': '5' } })).toBe(60_000);
        expect(retryAfterMs({ headers: {} })).toBe(60_000);
        expect(retryAfterMs({ headers: { 'retry-after': 'soon' } })).toBe(60_000);
        const past = new Date(Date.now() - 10_000).toUTCString();
        expect(retryAfterMs({ headers: { 'retry-after': past } })).toBe(60_000);
    });

    it('reads axios-style header objects with get()', () => {
        const headers = { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '90' : null) };
        expect(retryAfterMs({ headers })).toBe(90_000);
    });
});

describe('instanceBaseUrl', () => {
    afterEach(() => {
        delete (window as { settings?: unknown }).settings;
    });

    it('uses the ChurchTools base url inside ChurchTools', () => {
        (window as { settings?: unknown }).settings = { base_url: 'https://example.invalid' };
        expect(instanceBaseUrl()).toBe('https://example.invalid');
    });

    it('falls back to the page origin (dev proxy)', () => {
        expect(instanceBaseUrl()).toBe(window.location.origin);
    });
});

describe('createClient', () => {
    it('strips a trailing slash and builds /api urls', () => {
        const client = createClient('https://example.invalid/');
        expect(client.getBaseUrl()).toBe('https://example.invalid');
        expect(client.buildUrl('/whoami')).toBe('https://example.invalid/api/whoami');
    });

    it('enables CSRF tokens for REST writes', () => {
        const client = createClient('https://example.invalid');
        expect((client as unknown as { loadCSRFForApi: boolean }).loadCSRFForApi).toBe(true);
    });
});
