import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
