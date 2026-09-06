import {beforeEach, describe, expect, test, vi} from 'vitest';
import {AGENTS_DIR, SKILLS} from './agent/paths';
import {ensureBaseFiles} from './base-file-initializer';

const mocks = vi.hoisted(() => ({
    copyResource: vi.fn<(fromDir: string, targetName: string, toDir?: string) => void>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {copyResource: mocks.copyResource},
}));

describe('ensureBaseFiles', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('copies the bundled skills next to the agents', () => {
        ensureBaseFiles();
        expect(mocks.copyResource).toHaveBeenCalledWith(expect.any(String), SKILLS, AGENTS_DIR);
    });

    /** The skills are the whole of it: nothing else of ours belongs in the user's data folder. */
    test('lays down nothing else', () => {
        ensureBaseFiles();
        expect(mocks.copyResource).toHaveBeenCalledOnce();
    });

    test('looks the resources up relative to its own package', () => {
        ensureBaseFiles();
        expect(mocks.copyResource.mock.calls[0]![0]).toContain('deepclaw-agent');
    });
});
