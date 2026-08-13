import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {PermissionService} from '../services/permission-service';
import {editFileTool, readFileTool, writeFileTool} from './file-tool';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn<(path: string) => string>(() => ''),
    writeFile: vi.fn<(path: string, content: string) => string>((path) => path),
    isPathInWorkspace: vi.fn<(path: string) => boolean>(() => true),
}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        readFile: mocks.readFile,
        writeFile: mocks.writeFile,
        isPathInWorkspace: mocks.isPathInWorkspace,
    },
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const askPermissionGuard = vi.spyOn(PermissionService, 'askPermissionGuard');

describe('readFileTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('returns the whole file content', async () => {
        mocks.readFile.mockReturnValue('hello file');
        const result = await readFileTool.invoke({filePath: 'src/a.ts'}, newTestContext());
        expect(mocks.readFile).toHaveBeenCalledExactlyOnceWith('src/a.ts');
        expect(result).toBe('hello file');
    });

    test('cuts the content down to the requested limit', async () => {
        mocks.readFile.mockReturnValue('0123456789');
        const result = await readFileTool.invoke({filePath: 'src/a.ts', limit: 4}, newTestContext());
        expect(result).toBe('0123');
    });

    test('rejects a limit that cannot return anything', async () => {
        mocks.readFile.mockReturnValue('0123456789');
        await expect(readFileTool.invoke({filePath: 'src/a.ts', limit: 0}, newTestContext()))
            .rejects.toThrow('The limit has to be at least one character.');
        expect(mocks.readFile).not.toHaveBeenCalled();
    });

    test('asks for a limit of at least one character', () => {
        const properties = readFileTool.tool.schema.properties as {limit: {minimum: number}};
        expect(properties.limit.minimum).toBe(1);
    });
});

describe('writeFileTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('writes the content and reports the write back', async () => {
        const result = await writeFileTool.invoke({filePath: 'src/a.ts', content: 'body'}, newTestContext());
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith('src/a.ts', 'body');
        expect(result).toBe('agent.tools.file.write');
    });

    test('writes an empty file when the content is empty', async () => {
        await writeFileTool.invoke({filePath: 'src/a.ts', content: ''}, newTestContext());
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith('src/a.ts', '');
    });
});

describe('editFileTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('replaces every occurrence of the old text', async () => {
        mocks.readFile.mockReturnValue('foo bar foo');
        const result = await editFileTool.invoke(
            {filePath: 'src/a.ts', oldText: 'foo', newText: 'baz'}, newTestContext()
        );
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith('src/a.ts', 'baz bar baz');
        expect(result).toBe('agent.tools.file.edit');
    });

    test('rewrites the file unchanged when the old text is missing', async () => {
        mocks.readFile.mockReturnValue('foo bar');
        await editFileTool.invoke({filePath: 'src/a.ts', oldText: 'nope', newText: 'baz'}, newTestContext());
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith('src/a.ts', 'foo bar');
    });
});

describe('file tool guard', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        askPermissionGuard.mockReturnValue({result: 'allowed'});
    });

    test('allows a path inside the workspace', () => {
        mocks.isPathInWorkspace.mockReturnValue(true);
        expect(readFileTool.guard!({filePath: 'src/a.ts'}, newTestContext())).toEqual({result: 'allowed'});
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('asks the user for a path outside the workspace', () => {
        mocks.isPathInWorkspace.mockReturnValue(false);
        readFileTool.guard!({filePath: '/etc/passwd'}, newTestContext());
        expect(askPermissionGuard).toHaveBeenCalledExactlyOnceWith(
            'agent.tools.file.guard', 'file', 'agent.a1', 'agent'
        );
    });

    test('is shared by all three file tools', () => {
        expect(writeFileTool.guard).toBe(readFileTool.guard);
        expect(editFileTool.guard).toBe(readFileTool.guard);
    });
});

describe('file tool metadata', () => {

    test('only reading is allowed inside a sub loop', () => {
        expect(readFileTool.exclusiveInSubLoop).toBeUndefined();
        expect(writeFileTool.exclusiveInSubLoop).toBe(true);
        expect(editFileTool.exclusiveInSubLoop).toBe(true);
    });

    /** Every file operation runs to its end without awaiting, so none of them can interleave. */
    test('all file tools run next to other tool calls', () => {
        expect(readFileTool.parallelSafe).toBe(true);
        expect(writeFileTool.parallelSafe).toBe(true);
        expect(editFileTool.parallelSafe).toBe(true);
    });
});
