/** Fake-only switches (not part of the contract): transport failures, before or after the write happened. */
import { describe, expect, it } from 'vitest';
import { BackendUnreachable, UnexpectedResponse } from '@/backend/problems';
import { createFakeBackend } from './fake-backend';

const VALID = 'Abcdefgh1234!x';

describe('fake backend failure switches', () => {
    it('unreachable before the write: rejects and stores nothing', async () => {
        const fake = createFakeBackend({ requirePasswordForPasswordChange: false });
        fake.breakNext('unreachable');
        await expect(fake.putEntry(1, {})).rejects.toBeInstanceOf(BackendUnreachable);
        expect(fake.entries.has(1)).toBe(false);
    });

    it('unreachable after the write (a timeout): rejects, but the new password is stored', async () => {
        const fake = createFakeBackend({ requirePasswordForPasswordChange: false });
        fake.breakNext('unreachable', { afterWrite: true });
        await expect(fake.putEntry(1, {})).rejects.toBeInstanceOf(BackendUnreachable);
        expect(fake.entries.get(1)).toMatch(/^.{12}$/);
    });

    it('unexpected after the write keeps the custom password and reports the status', async () => {
        const fake = createFakeBackend({ requirePasswordForPasswordChange: false });
        fake.breakNext('unexpected', { afterWrite: true });
        const error = await fake.putEntry(1, { secondaryPwd: VALID }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(UnexpectedResponse);
        expect((error as UnexpectedResponse).status).toBe(502);
        expect(fake.entries.get(1)).toBe(VALID);
    });

    it('applies once', async () => {
        const fake = createFakeBackend({ requirePasswordForPasswordChange: false });
        fake.breakNext('unreachable');
        await expect(fake.getEntry(1)).rejects.toBeInstanceOf(BackendUnreachable);
        await expect(fake.getEntry(1)).resolves.toBe('none');
    });
});
