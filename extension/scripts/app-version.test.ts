import { describe, expect, it } from 'vitest';
import { appVersion, type Git } from './app-version';

function fakeGit(opts: { tag?: string; dirty?: boolean; sha?: string; unavailable?: boolean }): Git {
    return (args) => {
        if (opts.unavailable) throw new Error('git: not found');
        if (args.startsWith('describe')) {
            if (!opts.tag) throw new Error('no tag');
            return opts.tag;
        }
        if (args.startsWith('status')) return opts.dirty ? ' M file' : '';
        if (args.startsWith('rev-parse')) return opts.sha ?? 'abc1234';
        throw new Error(`unexpected ${args}`);
    };
}

describe('appVersion', () => {
    it('is the plain version on the matching extension tag', () => {
        expect(appVersion('0.1.0', fakeGit({ tag: 'extension-v0.1.0' }))).toBe('0.1.0');
    });
    it('adds the sha without a matching tag', () => {
        expect(appVersion('0.1.0', fakeGit({}))).toBe('0.1.0+abc1234');
        expect(appVersion('0.1.0', fakeGit({ tag: 'extension-v0.0.9' }))).toBe('0.1.0+abc1234');
    });
    it('adds -dirty with uncommitted changes, even on the tag', () => {
        expect(appVersion('0.1.0', fakeGit({ tag: 'extension-v0.1.0', dirty: true }))).toBe('0.1.0+abc1234-dirty');
    });
    it('is marked +unknown without git', () => {
        expect(appVersion('0.1.0', fakeGit({ unavailable: true }))).toBe('0.1.0+unknown');
    });
});
