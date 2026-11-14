// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDist, localSecrets } from './check-dist.js';

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

    describe('values of local .env files (security MINOR 5 of Task 17)', () => {
        const token = { name: 'CT_LOGIN_TOKEN', file: '.env', value: 'dummy-local-token-value' };

        it('fails when the value of a local CT_* variable appears in any text file, without printing it', () => {
            const failures = checkDist(
                makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js.map'), `{"x":"Login ${token.value}"}`)),
                { secrets: [token] },
            );
            expect(failures).toEqual(['the value of CT_LOGIN_TOKEN (from .env) in assets/index-abc.js.map']);
            expect(failures.join('\n')).not.toContain(token.value);
        });

        it('passes when no value appears', () => {
            expect(checkDist(makeDist(), { secrets: [token] })).toEqual([]);
        });
    });

    describe('localSecrets', () => {
        let envDir;
        beforeEach(() => {
            envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-dist-env-'));
        });
        afterEach(() => {
            fs.rmSync(envDir, { recursive: true, force: true });
        });
        const env = (file, content) => fs.writeFileSync(path.join(envDir, file), content);

        it('reads the CT_* values of .env and every .env.* file', () => {
            env('.env', 'CT_BASE_URL=https://gemeinde.example.org\nCT_LOGIN_TOKEN="abc def 123 456"\n');
            env('.env.real', "# comment\nexport CT_PASSWORD='dummy-password-value'\nCT_API_TOKEN=api-token-value # note\r\n");
            expect(localSecrets(envDir)).toEqual([
                { name: 'CT_BASE_URL', file: '.env', value: 'https://gemeinde.example.org' },
                { name: 'CT_LOGIN_TOKEN', file: '.env', value: 'abc def 123 456' },
                { name: 'CT_PASSWORD', file: '.env.real', value: 'dummy-password-value' },
                { name: 'CT_API_TOKEN', file: '.env.real', value: 'api-token-value' },
            ]);
        });

        it('also reads the old VITE_PASSWORD and VITE_BASE_URL an unmigrated .env may still hold, not VITE_USERNAME', () => {
            env('.env', 'VITE_USERNAME=someone@example.org\nVITE_PASSWORD=old-password-1\nVITE_BASE_URL=https://x.example.org\n');
            expect(localSecrets(envDir).map((s) => s.name)).toEqual(['VITE_PASSWORD', 'VITE_BASE_URL']);
        });

        it('skips other variables, values shorter than 8 characters and .env-example', () => {
            // `CT_LOGIN_TOKEN=   ` must not take the next line as its value (Node's util.parseEnv does).
            env('.env', 'OTHER_TOKEN=long-enough-value\nCT_CONTRACT_RECORD=1\nCT_LOGIN_TOKEN=   \nCT_PATH=/api\n#CT_X=commented-out-value\n');
            env('.env-example', 'CT_LOGIN_TOKEN=example-value-long\n');
            expect(localSecrets(envDir)).toEqual([]);
        });

        it('is empty without any .env file', () => {
            expect(localSecrets(envDir)).toEqual([]);
        });

        it('skips a folder named like an .env file', () => {
            fs.mkdirSync(path.join(envDir, '.env.d'));
            expect(localSecrets(envDir)).toEqual([]);
        });
    });

    describe('as a command', () => {
        const run = (d, ...more) => spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-dist.js'), d, ...more], { encoding: 'utf8' });
        /** A stand-in for src/dev/demo-data.ts (test only), next to the dist folder. */
        const stub = (source) => {
            const file = path.join(dir, '..', `${path.basename(dir)}-demo-data.mjs`);
            fs.writeFileSync(file, source);
            stubs.push(file);
            return file;
        };
        const stubs = [];
        afterEach(() => {
            while (stubs.length) fs.rmSync(stubs.pop(), { force: true });
        });

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

        it('fails closed when the demo data module has no strings', () => {
            const result = run(makeDist(), stub('export const DEMO_STRINGS = [];\n'));
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('no demo data strings');
        });

        it('fails closed when DEMO_STRINGS is not a list', () => {
            const result = run(makeDist(), stub('export const DEMO_STRINGS = "Beispielmann";\n'));
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('no demo data strings');
        });

        it('fails closed when the demo data module is missing', () => {
            const result = run(makeDist(), path.join(dir, 'no-such-demo-data.ts'));
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('demo data strings could not be loaded');
        });

        it('fails on a local .env value in the build, names the variable and never prints the value', () => {
            const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-dist-env-'));
            try {
                fs.writeFileSync(path.join(envDir, '.env.real'), 'CT_LOGIN_TOKEN=dummy-local-token-value\n');
                const result = run(
                    makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js'), '"dummy-local-token-value"')),
                    path.join(import.meta.dirname, '..', 'src', 'dev', 'demo-data.ts'),
                    envDir,
                );
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('the value of CT_LOGIN_TOKEN (from .env.real) in assets/index-abc.js');
                expect(result.stderr + result.stdout).not.toContain('dummy-local-token-value');
            } finally {
                fs.rmSync(envDir, { recursive: true, force: true });
            }
        });

        it('uses the strings of the given demo data module', () => {
            const result = run(makeDist((d) => fs.writeFileSync(path.join(d, 'assets', 'index-abc.js'), '"Zyxwvutsrq"')), stub('export const DEMO_STRINGS = ["Zyxwvutsrq"];\n'));
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('demo data "Zyxwvutsrq"');
        });
    });
});
