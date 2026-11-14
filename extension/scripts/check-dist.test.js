import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDist } from './check-dist.js';

let dir;

/** Builds a passing dist folder, then applies `mutate` to it. */
function makeDist(mutate = () => {}) {
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'index.html'),
        '<!doctype html><html><head><script type="module" src="/ccm/ctpassstore/assets/index-abc.js"></script></head><body></body></html>',
    );
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc.js'), 'console.log("hello");');
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc.css'), 'body{margin:0}');
    fs.writeFileSync(path.join(dir, 'THIRD-PARTY-LICENSES.txt'), 'vue 3.5.0\nMIT\n');
    mutate(dir);
    return dir;
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-dist-'));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('checkDist', () => {
    it('passes for one bundle and no inline script', () => {
        expect(checkDist(makeDist())).toEqual([]);
    });

    it('fails for two JavaScript bundles', () => {
        const failures = checkDist(makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'chunk-1.js'), '1;')));
        expect(failures.join('\n')).toMatch(/exactly one JavaScript bundle/);
    });

    it('counts an .mjs file as a second bundle', () => {
        const failures = checkDist(makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'chunk.mjs'), '1;')));
        expect(failures.join('\n')).toMatch(/exactly one JavaScript bundle/);
    });

    it('fails for an instance host inside a sourcemap', () => {
        const failures = checkDist(
            makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js.map'), '{"sourcesContent":["https://gemeinde.church.tools"]}')),
        );
        expect(failures.join('\n')).toMatch(/gemeinde\.church\.tools in assets\/index-abc\.js\.map|"gemeinde\.church\.tools" in assets/);
    });

    it('fails for an instance host inside the licence file', () => {
        const failures = checkDist(
            makeDist((d) => fs.appendFileSync(path.join(d, 'THIRD-PARTY-LICENSES.txt'), 'see https://gemeinde.church.tools')),
        );
        expect(failures.join('\n')).toMatch(/gemeinde\.church\.tools" in THIRD-PARTY-LICENSES\.txt/);
    });

    it('fails for an inline script without src', () => {
        const failures = checkDist(
            makeDist((d) => fs.writeFileSync(path.join(d, 'index.html'), '<html><script>alert(1)</script></html>')),
        );
        expect(failures.join('\n')).toMatch(/inline script/);
    });

    it('fails for an instance host', () => {
        const failures = checkDist(
            makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js'), 'fetch("https://gemeinde.church.tools/api")')),
        );
        expect(failures.join('\n')).toMatch(/gemeinde\.church\.tools/);
    });

    it('allows example.church.tools', () => {
        const failures = checkDist(
            makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js'), '"https://example.church.tools"')),
        );
        expect(failures).toEqual([]);
    });

    it('fails for a @font-face with an external URL', () => {
        const failures = checkDist(
            makeDist((d) =>
                fs.writeFileSync(
                    path.join(d, 'assets', 'index-abc.css'),
                    '@font-face{font-family:X;src:url(https://fonts.example.org/x.woff2)}',
                ),
            ),
        );
        expect(failures.join('\n')).toMatch(/external font/);
    });

    it('fails for the demo marker __DEMO__', () => {
        const failures = checkDist(
            makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js'), 'if(__DEMO__){}')),
        );
        expect(failures.join('\n')).toMatch(/demo/i);
    });

    it('fails for the demo marker inside a sourcemap or another text file', () => {
        const failures = checkDist(
            makeDist((d) => {
                fs.writeFileSync(path.join(d, 'assets', 'index-abc.js.map'), '{"sourcesContent":["const m = \\"__DEMO__\\""]}');
                fs.writeFileSync(path.join(d, 'assets', 'index-abc.css'), '/* __DEMO__ */');
            }),
        );
        expect(failures).toContain('demo code (__DEMO__) in assets/index-abc.js.map');
        expect(failures).toContain('demo code (__DEMO__) in assets/index-abc.css');
    });

    it('fails for a demo data string in any text file', () => {
        const failures = checkDist(
            makeDist((d) => {
                fs.writeFileSync(path.join(d, 'assets', 'index-abc.js'), 'const p = "Ada Beispielmann";');
                fs.appendFileSync(path.join(d, 'index.html'), '<!-- demo-oauth-client -->');
            }),
            { demoStrings: ['Ada Beispielmann', 'demo-oauth-client'] },
        );
        expect(failures).toContain('demo data "Ada Beispielmann" in assets/index-abc.js');
        expect(failures).toContain('demo data "demo-oauth-client" in index.html');
    });

    it('passes when no demo data string appears', () => {
        expect(checkDist(makeDist(), { demoStrings: ['Ada Beispielmann'] })).toEqual([]);
    });

    it('fails when THIRD-PARTY-LICENSES.txt is missing', () => {
        const failures = checkDist(makeDist((d) => fs.rmSync(path.join(d, 'THIRD-PARTY-LICENSES.txt'))));
        expect(failures.join('\n')).toMatch(/THIRD-PARTY-LICENSES\.txt/);
    });

    describe('as a command', () => {
        const run = (d) => spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-dist.js'), d], { encoding: 'utf8' });

        it('passes a clean build', () => {
            const result = run(makeDist());
            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);
        });

        it('fails on the demo data strings of src/dev/demo-data.ts', () => {
            const result = run(makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js'), '"Ada Beispielmann"')));
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('demo data "Beispielmann" in assets/index-abc.js');
        });
    });
});
