import {beforeEach, describe, expect, test, vi} from 'vitest';
import {AGENTS_DIR, DEEPCLAW_MD, SKILLS} from './agent/paths';
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

    test('copies the workspace instructions into the working directory', () => {
        ensureBaseFiles();
        expect(mocks.copyResource).toHaveBeenCalledWith(expect.any(String), DEEPCLAW_MD);
    });

    test('copies the bundled skills next to the agents', () => {
        ensureBaseFiles();
        expect(mocks.copyResource).toHaveBeenCalledWith(expect.any(String), SKILLS, AGENTS_DIR);
    });

    test('looks the resources up relative to its own package', () => {
        ensureBaseFiles();
        expect(mocks.copyResource.mock.calls[0]![0]).toContain('deepclaw-agent');
    });
});
