import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

/**
 * Shared Vitest defaults for the monorepo.
 * Per-package configs should mergeConfig(this, { test: { include: [...] } }).
 */
export default defineConfig({
    /**
     * The root as the filesystem spells it. A shell can hand over a working directory whose drive
     * letter is lowercase while node reports the path of every module with an uppercase one, and
     * taking the working directory as it comes leaves the two spellings apart: a mock of a relative
     * path is then filed under a name that no import ever asks for, so it is never used.
     */
    root: realpathSync.native(process.cwd()),
    resolve: {
        // The web app resolves "@/..." to its own src through tsconfig paths, which Vite does not read.
        alias: [{
            find: /^@\//,
            replacement: fileURLToPath(new URL('./apps/deepclaw-web/src/', import.meta.url)),
        }],
    },
    test: {
        // Specs that reload a module graph per test pay its transform cost inside the test body,
        // which outgrows the 5s default once the workers compete for the cpu.
        testTimeout: 30000,
        hookTimeout: 30000,
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '.git/**',
        ],
    },
});
