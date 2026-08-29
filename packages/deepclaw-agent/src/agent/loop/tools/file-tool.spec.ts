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

    test('leaves a footprint naming the file it read', async () => {
        const context = newTestContext();
        await readFileTool.invoke({filePath: 'src/a.ts'}, context);
        expect(context.actions.addFootPrint)
            .toHaveBeenCalledExactlyOnceWith({type: 'read_file', content: 'src/a.ts'});
    });

    /** Part of a file is still a file the run has seen, and the one the trace is most use for. */
    test('leaves a footprint for a read cut down to a limit', async () => {
        mocks.readFile.mockReturnValue('0123456789');
        const context = newTestContext();
        await readFileTool.invoke({filePath: 'src/a.ts', limit: 4}, context);
        expect(context.actions.addFootPrint)
            .toHaveBeenCalledExactlyOnceWith({type: 'read_file', content: 'src/a.ts'});
    });

    /** The trace says the run holds the file, and a read that threw holds nothing. */
    test('leaves no footprint where the file could not be read', async () => {
        mocks.readFile.mockImplementationOnce(() => {
            throw new Error('File src/a.ts not found.');
        });
        const context = newTestContext();
        await expect(readFileTool.invoke({filePath: 'src/a.ts'}, context)).rejects.toThrow();
        expect(context.actions.addFootPrint).not.toHaveBeenCalled();
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

    test('leaves a footprint naming the file it wrote', async () => {
        const context = newTestContext();
        await writeFileTool.invoke({filePath: 'src/a.ts', content: 'body'}, context);
        expect(context.actions.addFootPrint)
            .toHaveBeenCalledExactlyOnceWith({type: 'write_file', content: 'src/a.ts'});
    });

    /**
     * A write that threw changed nothing, and a trace saying it did sends whoever reads it to a
     * file that never took the content.
     */
    test('leaves no footprint where the write failed', async () => {
        mocks.writeFile.mockImplementationOnce(() => {
            throw new Error('Read-only file system.');
        });
        const context = newTestContext();
        await expect(writeFileTool.invoke({filePath: 'src/a.ts', content: 'body'}, context))
            .rejects.toThrow();
        expect(context.actions.addFootPrint).not.toHaveBeenCalled();
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

    /** The read it does on the way is the edit itself, not a file the run went and looked at. */
    test('leaves one footprint, for the edit rather than the read behind it', async () => {
        mocks.readFile.mockReturnValue('foo bar foo');
        const context = newTestContext();
        await editFileTool.invoke({filePath: 'src/a.ts', oldText: 'foo', newText: 'baz'}, context);
        expect(context.actions.addFootPrint)
            .toHaveBeenCalledExactlyOnceWith({type: 'edit_file', content: 'src/a.ts'});
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

    /** The list handed over is the one of the conversation, a grant belongs to it and to nothing else. */
    test('asks the user for a path outside the workspace', () => {
        mocks.isPathInWorkspace.mockReturnValue(false);
        const context = newTestContext();
        readFileTool.guard!({filePath: '/etc/passwd'}, context);
        expect(askPermissionGuard).toHaveBeenCalledExactlyOnceWith(
            'agent.tools.file.guard', 'file', context.permissionWhiteList
        );
    });

    test('is shared by all three file tools', () => {
        expect(writeFileTool.guard).toBe(readFileTool.guard);
        expect(editFileTool.guard).toBe(readFileTool.guard);
    });
});

describe('file tool metadata', () => {

    /** A run that works a task has to be able to finish it, which includes writing it out. */
    test('reading and writing are both allowed in every kind of loop', () => {
        expect(readFileTool.loopKinds).toBeUndefined();
        expect(writeFileTool.loopKinds).toBeUndefined();
        expect(editFileTool.loopKinds).toBeUndefined();
    });

    /** Every file operation runs to its end without awaiting, so none of them can interleave. */
    test('all file tools run next to other tool calls', () => {
        expect(readFileTool.parallelSafe).toBe(true);
        expect(writeFileTool.parallelSafe).toBe(true);
        expect(editFileTool.parallelSafe).toBe(true);
    });
});
