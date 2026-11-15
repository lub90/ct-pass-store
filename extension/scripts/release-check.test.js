// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRelease } from './release-check.js';

let repo;
let ext;

const CHANGELOG = `# Changelog

All notable changes to the extension.

## [0.1.0] - 2026-11-20

### Changed

- New design.

## [0.0.9] - 2026-01-02

- Old things.
`;

/** Writes a consistent release of 0.1.0 into a fresh repository folder, then applies `mutate`. */
function makeRepo(mutate = () => {}) {
    ext = path.join(repo, 'extension');
    fs.mkdirSync(ext, { recursive: true });
    fs.mkdirSync(path.join(repo, 'backend'), { recursive: true });
    fs.writeFileSync(path.join(ext, 'package.json'), JSON.stringify({ name: 'ctpassstore', version: '0.1.0' }, null, 4));
    fs.writeFileSync(
        path.join(ext, 'package-lock.json'),
        JSON.stringify({ name: 'ctpassstore', version: '0.1.0', lockfileVersion: 3, packages: { '': { name: 'ctpassstore', version: '0.1.0' } } }),
    );
    fs.writeFileSync(path.join(ext, 'CHANGELOG.md'), CHANGELOG);
    fs.writeFileSync(path.join(repo, 'backend', 'VERSION'), '0.1.3\n');
    mutate();
    return ext;
}

const write = (file, content) => fs.writeFileSync(path.join(ext, file), content);
const json = (file, change) => write(file, JSON.stringify(change(JSON.parse(fs.readFileSync(path.join(ext, file), 'utf8')))));

beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-'));
});
afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

describe('checkRelease', () => {
    it('passes a consistent release and returns its CHANGELOG section as notes', () => {
        const { problems, notes } = checkRelease('extension-v0.1.0', makeRepo());
        expect(problems).toEqual([]);
        expect(notes).toBe('### Changed\n\n- New design.\n');
    });

    it('passes the last section of the file too', () => {
        const dir = makeRepo(() => {
            write('CHANGELOG.md', '# Changelog\n\n## [0.1.0] - 2026-11-20\n\n- Only one.\n');
        });
        expect(checkRelease('extension-v0.1.0', dir)).toEqual({ problems: [], notes: '- Only one.\n' });
    });

    it.each(['v0.1.0', 'backend-v0.1.0', 'extension-v0.1', 'extension-v0.1.0-rc1', 'extension-v0.1.0 ', ''])(
        'refuses the tag %j',
        (tag) => {
            const { problems, notes } = checkRelease(tag, makeRepo());
            expect(problems).toEqual([`tag "${tag}" is not extension-vMAJOR.MINOR.PATCH`]);
            expect(notes).toBe('');
        },
    );

    it('names a package.json version that differs from the tag', () => {
        const dir = makeRepo(() => json('package.json', (p) => ({ ...p, version: '0.1.1' })));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual([
            'package.json has version 0.1.1, the tag extension-v0.1.0 needs 0.1.0',
        ]);
    });

    it('names a missing package.json', () => {
        const dir = makeRepo(() => fs.rmSync(path.join(ext, 'package.json')));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['package.json is missing or has no version']);
    });

    it('names a package.json that is no JSON', () => {
        const dir = makeRepo(() => write('package.json', '{ "version": '));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['package.json is missing or has no version']);
    });

    it('names a package-lock.json version that differs from the tag', () => {
        const dir = makeRepo(() => json('package-lock.json', (p) => ({ ...p, version: '0.0.9' })));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual([
            'package-lock.json has version 0.0.9, the tag extension-v0.1.0 needs 0.1.0',
        ]);
    });

    it('names a package-lock.json root package version that differs from the tag', () => {
        const dir = makeRepo(() => json('package-lock.json', (p) => ({ ...p, packages: { '': { version: '0.0.9' } } })));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual([
            'package-lock.json (packages[""]) has version 0.0.9, the tag extension-v0.1.0 needs 0.1.0',
        ]);
    });

    it('names a package-lock.json without the root package entry packages[""]', () => {
        const dir = makeRepo(() => json('package-lock.json', (p) => ({ ...p, packages: {} })));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['package-lock.json has no root package entry packages[""]']);
    });

    it('names a package-lock.json without packages', () => {
        const dir = makeRepo(() => json('package-lock.json', (p) => { delete p.packages; return p; }));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['package-lock.json has no root package entry packages[""]']);
    });

    it('names a missing package-lock.json', () => {
        const dir = makeRepo(() => fs.rmSync(path.join(ext, 'package-lock.json')));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['package-lock.json is missing or has no version']);
    });

    it('names a missing CHANGELOG section', () => {
        const dir = makeRepo(() => write('CHANGELOG.md', CHANGELOG.replace('[0.1.0]', '[0.1.1]')));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['CHANGELOG.md has no section "## [0.1.0] - YYYY-MM-DD"']);
    });

    it('names a missing CHANGELOG.md', () => {
        const dir = makeRepo(() => fs.rmSync(path.join(ext, 'CHANGELOG.md')));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['CHANGELOG.md has no section "## [0.1.0] - YYYY-MM-DD"']);
    });

    it('does not take a section of a version that only starts like the tag', () => {
        const dir = makeRepo(() => write('CHANGELOG.md', '# Changelog\n\n## [0.1.00] - 2026-11-20\n\n- x\n'));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['CHANGELOG.md has no section "## [0.1.0] - YYYY-MM-DD"']);
    });

    it.each([
        '## [0.1.0]',
        '## [0.1.0] - Unreleased',
        '## [0.1.0] - 2026-13-01',
        '## [0.1.0] - 2026-02-30',
        '## [0.1.0] - 20-11-2026',
        '## [0.1.0] 2026-11-20',
        '## [0.1.0]  - 2026-11-20',
        '## [0.1.0] - 2026-11-20 (beta)',
        '## [0.1.0] - 2026-11-20 ',
        '## [0.1.0] – 2026-11-20',
    ])('names the section heading %j, which is not exactly "## [0.1.0] - YYYY-MM-DD" with a real date', (heading) => {
        const dir = makeRepo(() => write('CHANGELOG.md', CHANGELOG.replace('## [0.1.0] - 2026-11-20', heading)));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual([
            `CHANGELOG.md: the heading of section [0.1.0] must be "## [0.1.0] - YYYY-MM-DD" with a real date, found "${heading}"`,
        ]);
    });

    it('names two sections for the same version', () => {
        const dir = makeRepo(() => write('CHANGELOG.md', CHANGELOG + '\n## [0.1.0] - 2026-11-21\n\n- Again.\n'));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['CHANGELOG.md has 2 sections for [0.1.0]']);
    });

    it('names an empty CHANGELOG section', () => {
        const dir = makeRepo(() => write('CHANGELOG.md', '# Changelog\n\n## [0.1.0] - 2026-11-20\n\n## [0.0.9] - 2026-01-02\n\n- x\n'));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['CHANGELOG.md: section [0.1.0] is empty']);
    });

    it('names an Unreleased section (spec 13.7: none on a release)', () => {
        const dir = makeRepo(() => write('CHANGELOG.md', CHANGELOG.replace('## [0.1.0]', '## [Unreleased]\n\n- Later.\n\n## [0.1.0]')));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['CHANGELOG.md still has an "## [Unreleased]" section']);
    });

    it('names a MAJOR.MINOR that differs from backend/VERSION', () => {
        const dir = makeRepo(() => fs.writeFileSync(path.join(repo, 'backend', 'VERSION'), '0.2.0\n'));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual([
            'MAJOR.MINOR 0.1 differs from the backend\'s 0.2 (backend/VERSION 0.2.0, versioning.md)',
        ]);
    });

    it('compares MAJOR.MINOR as numbers in the version, not as a prefix', () => {
        const dir = makeRepo(() => fs.writeFileSync(path.join(repo, 'backend', 'VERSION'), '0.10.0\n'));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual([
            'MAJOR.MINOR 0.1 differs from the backend\'s 0.10 (backend/VERSION 0.10.0, versioning.md)',
        ]);
    });

    it('names a missing or broken backend/VERSION', () => {
        const dir = makeRepo(() => fs.writeFileSync(path.join(repo, 'backend', 'VERSION'), 'one\n'));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['backend/VERSION is missing or has no version x.y.z']);
        fs.rmSync(path.join(repo, 'backend', 'VERSION'));
        expect(checkRelease('extension-v0.1.0', dir).problems).toEqual(['backend/VERSION is missing or has no version x.y.z']);
    });

    it('names every mismatch at once, and returns no notes then', () => {
        const dir = makeRepo(() => {
            json('package.json', (p) => ({ ...p, version: '0.1.1' }));
            json('package-lock.json', (p) => ({ ...p, version: '0.1.2' }));
            write('CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n\n- x\n');
            fs.writeFileSync(path.join(repo, 'backend', 'VERSION'), '1.1.0\n');
        });
        const { problems, notes } = checkRelease('extension-v0.1.0', dir);
        expect(problems).toHaveLength(5);
        expect(problems.join('\n')).toMatch(/package\.json has version 0\.1\.1/);
        expect(problems.join('\n')).toMatch(/package-lock\.json has version 0\.1\.2/);
        expect(problems.join('\n')).toMatch(/no section "## \[0\.1\.0\]/);
        expect(problems.join('\n')).toMatch(/Unreleased/);
        expect(problems.join('\n')).toMatch(/MAJOR\.MINOR 0\.1 differs/);
        expect(notes).toBe('');
    });

    describe('as a command', () => {
        const run = (...args) => spawnSync(process.execPath, [path.join(import.meta.dirname, 'release-check.js'), ...args], { encoding: 'utf8' });

        it('prints the notes on stdout and exits 0', () => {
            const result = run('extension-v0.1.0', makeRepo());
            expect(result.stderr).toBe('');
            expect(result.stdout).toBe('### Changed\n\n- New design.\n');
            expect(result.status).toBe(0);
        });

        it('prints one line per problem on stderr, nothing on stdout, and exits 1', () => {
            const dir = makeRepo(() => {
                json('package.json', (p) => ({ ...p, version: '0.1.1' }));
                fs.writeFileSync(path.join(repo, 'backend', 'VERSION'), '0.2.0\n');
            });
            const result = run('extension-v0.1.0', dir);
            expect(result.stdout).toBe('');
            expect(result.stderr.trim().split('\n')).toEqual([
                'package.json has version 0.1.1, the tag extension-v0.1.0 needs 0.1.0',
                'MAJOR.MINOR 0.1 differs from the backend\'s 0.2 (backend/VERSION 0.2.0, versioning.md)',
            ]);
            expect(result.status).toBe(1);
        });

        it('needs a tag argument', () => {
            const result = run();
            expect(result.stderr).toMatch(/Usage: node scripts\/release-check\.js <tag>/);
            expect(result.status).toBe(1);
        });

        it('checks the real extension folder by default (its package.json and package-lock.json agree)', () => {
            const version = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;
            const result = run(`extension-v${version}`);
            expect(result.stderr).not.toMatch(/package(-lock)?\.json/);
            expect(result.stderr).not.toMatch(/MAJOR\.MINOR/);
        });
    });
});
