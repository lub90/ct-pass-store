import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/** `x.y.z` on an `extension-v<x.y.z>` tag, otherwise `x.y.z+sha` (plus `-dirty` with uncommitted changes). */
function appVersion(): string {
    const base = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
    const git = (args: string) => execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    try {
        let tagged = false;
        try {
            tagged = git("describe --exact-match --tags --match 'extension-v*' HEAD") === `extension-v${base}`;
        } catch {
            // HEAD carries no extension tag
        }
        const dirty = git('status --porcelain') !== '';
        if (tagged && !dirty) return base;
        return `${base}+${git('rev-parse --short HEAD')}${dirty ? '-dirty' : ''}`;
    } catch {
        return base; // no git available
    }
}

/** Writes the licence texts of all bundled npm packages to THIRD-PARTY-LICENSES.txt. */
function thirdPartyLicenses(): Plugin {
    return {
        name: 'third-party-licenses',
        generateBundle(_options, bundle) {
            const packages = new Map<string, string>();
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk') continue;
                for (const id of chunk.moduleIds) {
                    const match = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id);
                    if (match?.[1]) packages.set(match[1], match[1]);
                }
            }
            const entries: string[] = [];
            for (const dir of [...packages.keys()].sort()) {
                const pkgFile = path.join(dir, 'package.json');
                if (!fs.existsSync(pkgFile)) continue;
                const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { name: string; version: string; license?: string };
                const licenseFile = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
                const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : '(no licence file in the package)';
                entries.push(`${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? 'unknown'}\n\n${text}`);
            }
            this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source: entries.join('\n\n----------\n\n') + '\n' });
        },
    };
}

export default defineConfig(({ mode }) => {
    // CT_* variables have no VITE_ prefix: they are used here only and never reach the bundle.
    const env = loadEnv(mode, root, 'CT_');
    const proxy =
        mode === 'real' && env.CT_BASE_URL
            ? {
                  '/api': {
                      target: env.CT_BASE_URL,
                      changeOrigin: true,
                      headers: { Authorization: `Login ${env.CT_LOGIN_TOKEN ?? ''}` },
                  },
              }
            : undefined;

    return {
        base: '/ccm/ctpassstore/',
        plugins: [vue(), thirdPartyLicenses()],
        define: { __APP_VERSION__: JSON.stringify(appVersion()) },
        resolve: { alias: { '@': path.join(root, 'src') } },
        server: { proxy },
        build: {
            modulePreload: { polyfill: false },
            rollupOptions: { output: { inlineDynamicImports: true } },
        },
    };
});
