import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';

export default defineConfigWithVueTs(
    { ignores: ['dist/**', 'coverage/**', 'test-results/**', 'playwright-report/**', 'releases/**', 'tests/contract/fixtures/**'] },
    js.configs.recommended,
    pluginVue.configs['flat/recommended'],
    vueTsConfigs.recommended,
    { rules: { 'vue/html-indent': ['warn', 4] } },
    // The library's components are named as the spec does (Icon, Banner, Pill): single words by design.
    { files: ['src/ui/**/*.vue'], rules: { 'vue/multi-word-component-names': 'off' } },
    {
        files: ['scripts/**/*.js'],
        languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    },
);
