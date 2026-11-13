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

    it('fails when THIRD-PARTY-LICENSES.txt is missing', () => {
        const failures = checkDist(makeDist((d) => fs.rmSync(path.join(d, 'THIRD-PARTY-LICENSES.txt'))));
        expect(failures.join('\n')).toMatch(/THIRD-PARTY-LICENSES\.txt/);
    });
});
