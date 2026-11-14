import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite';
import { appVersion } from './scripts/app-version.ts';
import { devProxy, ENV_PREFIX, realModeGuard } from './scripts/dev-proxy.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function gitVersion(): string {
    const base = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
    return appVersion(base, (args) =>
        execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    );
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

/**
 * Refuses every build that isn't a production build (mode `production` and `NODE_ENV` production, so
 * `import.meta.env.DEV` is false): a release must never ship the demo or development code (spec 13.7). Only the build
 * tests (`scripts/build.test.ts`) pass it with `CPS_ALLOW_NON_PRODUCTION_BUILD=1`, to show what such a build contains.
 */
function productionBuildsOnly(): Plugin {
    return {
        name: 'production-builds-only',
        configResolved(config) {
            if (config.command !== 'build' || process.env.CPS_ALLOW_NON_PRODUCTION_BUILD === '1') return;
            if (config.mode !== 'production' || !config.isProduction) {
                throw new Error(
                    `only production builds are allowed: this one has mode "${config.mode}" and ` +
                        `NODE_ENV "${process.env.NODE_ENV ?? ''}"; run \`npm run build\` without --mode and NODE_ENV`,
                );
            }
        },
    };
}

export interface ConfigEnv {
    mode: string;
    command: 'build' | 'serve';
    isPreview?: boolean;
}

/**
 * The app's Vite config. `envDir` is where `.env` is read from (only by the dev server in mode `real`); tests pass a
 * folder with invented values.
 */
export function appConfig({ mode, command, isPreview }: ConfigEnv, envDir: string = root): UserConfig {
    // CT_* variables have no VITE_ prefix: they are used here only (the dev proxy of --mode real), never in the bundle.
    // Only the dev server reads them; a build and `vite preview` (which would reuse `server.proxy`) never do.
    const proxy = command === 'serve' && !isPreview ? devProxy(mode, loadEnv(mode, envDir, 'CT_')) : undefined;

    return {
        base: '/ccm/ctpassstore/',
        envPrefix: ENV_PREFIX,
        plugins: [productionBuildsOnly(), vue(), thirdPartyLicenses(), ...(proxy ? [realModeGuard()] : [])],
        define: { __APP_VERSION__: JSON.stringify(gitVersion()) },
        resolve: { alias: { '@': path.join(root, 'src') } },
        server: { proxy },
        build: {
            modulePreload: { polyfill: false },
            rollupOptions: { output: { inlineDynamicImports: true } },
        },
    };
}

export default defineConfig((env) => appConfig(env));
