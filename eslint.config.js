import tsParser from '@typescript-eslint/parser';
import tseslint from "typescript-eslint";
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

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
    ignores: ['dist/**/*', 'node_modules/**/*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
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
  {
    files: ['src/ui/**/*.{ts,tsx}', 'main.tsx'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: tsLanguageOptions,
  },
  ...tseslint.configs.recommended.map(config => ({
    files: ['src/**/*.ts'],
    ignores: ['src/ui/**/*'],
    ...config,
    languageOptions: tsLanguageOptions,
    rules: {
      'no-unused-vars': 'off',
    },
  }))
];