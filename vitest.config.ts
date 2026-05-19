import {defineConfig} from 'vitest/config';

/**
 * Shared Vitest defaults for the monorepo.
 * Per-package configs should mergeConfig(this, { test: { include: [...] } }).
 */
export default defineConfig({
    test: {
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '.git/**',
        ],
    },
});
