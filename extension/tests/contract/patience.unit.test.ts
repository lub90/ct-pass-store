// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BackendApi } from '@/backend/api';
import { BackendProblem } from '@/backend/problems';
import { patientApi, patiently } from './patience';

const problem = (slug: string, retryAfter?: number) => Object.assign(new BackendProblem(slug, slug === 'upstream-rate-limited' ? 503 : 400), retryAfter === undefined ? {} : { retryAfter });
const rateLimited = (retryAfter?: number) => problem('upstream-rate-limited', retryAfter);

/** A call that fails with `errors` in turn, then resolves with 'done'. */
function failing(...errors: unknown[]) {
    return vi.fn(async () => {
        const e = errors.shift();
        if (e !== undefined) throw e;
        return 'done';
    });
}

describe('patiently', () => {
    it('waits out upstream-rate-limited (retryAfter, 60 s without one, at most 90 s) and sends the call again', async () => {
        const waits: number[] = [];
        const onWait = vi.fn();
        const call = failing(rateLimited(7), rateLimited());
        await expect(patiently(call, async (s) => void waits.push(s), onWait)).resolves.toBe('done');
        expect(call).toHaveBeenCalledTimes(3);
        expect(waits).toEqual([7, 60]);
        expect(onWait).toHaveBeenCalledTimes(2);

        waits.length = 0;
        await patiently(failing(rateLimited(3600)), async (s) => void waits.push(s));
        expect(waits).toEqual([90]);
    });

    it('gives up after 3 attempts and passes the last error on unchanged', async () => {
        const last = rateLimited(1);
        const call = failing(rateLimited(1), rateLimited(1), last, rateLimited(1));
        const wait = vi.fn(async () => undefined);
        await expect(patiently(call, wait)).rejects.toBe(last);
        expect(call).toHaveBeenCalledTimes(3);
        expect(wait).toHaveBeenCalledTimes(2);
    });

    it('rethrows any other problem or error at once', async () => {
        for (const error of [problem('too-many-attempts', 60), problem('invalid-primary-password'), problem('backend-unreachable'), new Error('network'), Object.assign(new Error('not a BackendProblem'), { slug: 'upstream-rate-limited' })]) {
            const call = failing(error);
            const wait = vi.fn(async () => undefined);
            await expect(patiently(call, wait)).rejects.toBe(error);
            expect(call).toHaveBeenCalledTimes(1);
            expect(wait).not.toHaveBeenCalled();
        }
    });
});

describe('patientApi', () => {
    const fakeApi = (error: unknown) => {
        const calls: string[] = [];
        const fail = async (name: string): Promise<never> => {
            calls.push(name);
            throw error;
        };
        const api: BackendApi = {
            login: () => fail('login'),
            getEntry: () => fail('get'),
            putEntry: () => fail('put'),
            deleteEntry: () => fail('delete'),
            selfTest: () => fail('selfTest'),
        };
        return { api, calls };
    };
    const noWait = async () => undefined;

    it('resends entry and self-test calls without a primary password or with the right one', async () => {
        const { api, calls } = fakeApi(rateLimited(1));
        const patient = patientApi(api, 'right', noWait);
        await expect(patient.getEntry(1)).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.putEntry(1, {})).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.putEntry(1, { primaryPwd: 'right', secondaryPwd: 'x' })).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.deleteEntry(1)).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.deleteEntry(1, 'right')).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.selfTest()).rejects.toBeInstanceOf(BackendProblem);
        expect(calls).toEqual(['get', 'get', 'get', 'put', 'put', 'put', 'put', 'put', 'put', 'delete', 'delete', 'delete', 'delete', 'delete', 'delete', 'selfTest', 'selfTest', 'selfTest']);
    });

    it('sends a call with a deliberately wrong primary password once, and login once', async () => {
        const { api, calls } = fakeApi(rateLimited(1));
        const patient = patientApi(api, 'right', noWait);
        await expect(patient.putEntry(1, { primaryPwd: 'right-wrong' })).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.putEntry(1, { primaryPwd: '' })).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.deleteEntry(1, 'right-wrong')).rejects.toBeInstanceOf(BackendProblem);
        await expect(patient.login('c', 'v', 'r')).rejects.toBeInstanceOf(BackendProblem);
        expect(calls).toEqual(['put', 'put', 'delete', 'login']);

        // Without a required primary password, any primary password sent is one the backend doesn't expect: once too.
        const other = fakeApi(rateLimited(1));
        await expect(patientApi(other.api, null, noWait).deleteEntry(1, 'something')).rejects.toBeInstanceOf(BackendProblem);
        expect(other.calls).toEqual(['delete']);
    });
});
