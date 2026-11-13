import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Unit and app tests. Contract tests (real instance) have their own config.
export default defineConfig({
    plugins: [vue()],
    define: { __APP_VERSION__: JSON.stringify('test') },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.ts', 'scripts/**/*.test.js'],
        passWithNoTests: true,
    },
});
