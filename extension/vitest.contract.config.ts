import { defineConfig } from 'vitest/config';

// Contract tests run against a real ChurchTools test instance (see the testing docs).
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/contract/**/*.test.ts'],
        passWithNoTests: true,
    },
});
