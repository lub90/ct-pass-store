import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';

export default defineConfigWithVueTs(
    { ignores: ['dist/**', 'coverage/**', 'test-results/**', 'playwright-report/**', 'releases/**', 'tests/contract/fixtures/**'] },
    js.configs.recommended,
    pluginVue.configs['flat/recommended'],
    vueTsConfigs.recommended,
    { rules: { 'vue/html-indent': ['warn', 4] } },
    {
        files: ['scripts/**/*.js'],
        languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    },
);
