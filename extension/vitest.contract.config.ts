import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Contract tests run against a real ChurchTools test instance and the real backend (docs/development.md, "Contract
// tests"). `tests/contract/setup.ts` aborts the run before any test when a variable or fixture is missing.
export default defineConfig({
    define: { __APP_VERSION__: JSON.stringify('contract') },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: {
        environment: 'node',
        include: ['tests/contract/**/*.test.ts'],
        // The helpers' own unit tests run in the unit suite (vitest.config.ts).
        exclude: ['tests/contract/**/*.unit.test.ts', '**/node_modules/**'],
        globalSetup: ['tests/contract/setup.ts'],
        passWithNoTests: false,
        // The files share the test instance (rights, temporary objects): one at a time.
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 180_000,
    },
});
