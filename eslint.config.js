import tsParser from '@typescript-eslint/parser';
import tseslint from "typescript-eslint";
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import nextVitals from 'eslint-config-next/core-web-vitals'

const tsLanguageOptions = {
  parser: tsParser,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  globals: {
    ...globals.node,
  },
};

export default [
  {
    ignores: ['**/dist/**/*', '**/node_modules/**/*', '**/.next/**', '**/out/**', '**/build/**', '**/*.d.ts', '**/*.d.tsx'],
  },
  {
    files: ['**/src/**/*.ts', '**/src/**/*.tsx'],
    languageOptions: tsLanguageOptions,
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // Use TS-aware unused-vars rule for type positions/signatures.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  // eslint-config-next exports a Config[]; spread it into this array, never into a {...} object.
  ...nextVitals.map((config) =>
    config.files == null
      ? config
      : {
          ...config,
          files: ['apps/deepclaw-web/**/*.{ts,tsx}'],
        },
  ),
  {
    files: ['apps/deepclaw-tui/src/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: tsLanguageOptions,
  },
  ...tseslint.configs.recommended.map(config => ({
    files: ['**/src/**/*.ts'],
    ignores: ['apps/deepclaw-tui/src/**/*', 'apps/deepclaw-web/src/**/*'],
    ...config,
    languageOptions: tsLanguageOptions,
    rules: {
      'no-unused-vars': 'off',
    },
  }))
];