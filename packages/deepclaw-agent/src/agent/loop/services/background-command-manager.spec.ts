import {describe, expect, test, vi} from 'vitest';
import {type BackgroundCommand} from './background-command-manager';

const mocks = vi.hoisted(() => ({
    runCommandAsync: vi.fn<(command: string) => Promise<{output: string, preview: string}>>(),
    writeFile: vi.fn<(filePath: string, content: string) => string>(),
    deleteFile: vi.fn<(filePath: string) => void>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {writeFile: mocks.writeFile, deleteFile: mocks.deleteFile},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    runCommandAsync: mocks.runCommandAsync,
}));

/** The manager keeps its registry in module scope, so every test starts from a fresh module. */
async function loadManager() {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.writeFile.mockImplementation((filePath: string) => filePath);
    mocks.deleteFile.mockImplementation(() => undefined);
    mocks.runCommandAsync.mockReturnValue(new Promise(() => undefined));
    return (await import('./background-command-manager')).BackgroundCommandManager;
}

/** Pays the transform of the module graph while the file loads, out of reach of a test timeout. */
await loadManager();

function newCommand(overrides: Partial<BackgroundCommand> = {}): BackgroundCommand {
    return {
        id: 'bg1',
        title: 'build the app',
        command: 'npm run build',
        createdAt: '2024-01-01T00:00:00.000Z',
        status: 'running',
        creator: 'a1',
        ...overrides,
    };
}

describe('runCommand', () => {

    test('registers the command under the background folder of the session', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        expect(manager.getCommandStatus('bg1')).toEqual({
            id: 'bg1',
            title: 'build the app',
            preview: undefined,
            outputPath: '.agents/a1/session/background_commands/bg1.bgout',
            status: 'running',
        });
    });

    test('starts the shell command without waiting for it', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand({command: 'sleep 1'}), '.agents/a1/session');
        expect(mocks.runCommandAsync).toHaveBeenCalledExactlyOnceWith('sleep 1');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('stores the output and the preview once the command succeeds', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'full output', preview: 'full...'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1').status).toBe('completed'));
        expect(manager.getCommandStatus('bg1').preview).toBe('full...');
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/a1/session/background_commands/bg1.bgout', 'full output'
        );
    });

    test('keeps the path the writer answered with', async () => {
        const manager = await loadManager();
        mocks.writeFile.mockReturnValue('sanitized/bg1.bgout');
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1').status).toBe('completed'));
        expect(manager.getCommandStatus('bg1').outputPath).toBe('sanitized/bg1.bgout');
    });

    test('reports a failing command as completed with the error text', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockRejectedValue(new Error('command exploded'));
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1').status).toBe('completed'));
        expect(manager.getCommandStatus('bg1').preview).toBe('Error: command exploded');
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/a1/session/background_commands/bg1.bgout', 'Error: command exploded'
        );
    });

    test('falls back to an unknown error when the failure carries no message', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockRejectedValue(undefined);
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1').status).toBe('completed'));
        expect(manager.getCommandStatus('bg1').preview).toBe('Error: Unknown error');
    });

    test('writes an empty file when the command produced no output', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: '', preview: ''});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
        expect(mocks.writeFile).toHaveBeenCalledWith(
            '.agents/a1/session/background_commands/bg1.bgout', ''
        );
    });

    test('replaces a command registered again under the same id', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        manager.runCommand(newCommand({title: 'run the tests'}), '.agents/a1/session');
        expect(manager.getAllCommandsStatus()).toHaveLength(1);
        expect(manager.getCommandStatus('bg1').title).toBe('run the tests');
    });
});

describe('getCommandStatus', () => {

    test('fails for an id that was never registered', async () => {
        const manager = await loadManager();
        expect(() => manager.getCommandStatus('ghost')).toThrow('Command not found: ghost');
    });

    test('hides the command line and the creator from the reported status', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        expect(Object.keys(manager.getCommandStatus('bg1')).sort())
            .toEqual(['id', 'outputPath', 'preview', 'status', 'title']);
    });
});

describe('getAllCommandsStatus', () => {

    test('answers with an empty list when nothing was started', async () => {
        const manager = await loadManager();
        expect(manager.getAllCommandsStatus()).toEqual([]);
    });

    test('reports every registered command', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand({id: 'bg1'}), '.agents/a1/session');
        manager.runCommand(newCommand({id: 'bg2'}), '.agents/a1/session');
        expect(manager.getAllCommandsStatus().map(command => command.id)).toEqual(['bg1', 'bg2']);
    });
});

describe('removeCommand', () => {

    test('forgets the command and deletes its output file', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        manager.removeCommand('bg1');
        expect(mocks.deleteFile)
            .toHaveBeenCalledExactlyOnceWith('.agents/a1/session/background_commands/bg1.bgout');
        expect(() => manager.getCommandStatus('bg1')).toThrow('Command not found: bg1');
    });

    test('does nothing for an unknown id', async () => {
        const manager = await loadManager();
        manager.removeCommand('ghost');
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });

    test('also drops the command from the finished queue', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1').status).toBe('completed'));
        manager.removeCommand('bg1');
        expect(manager.drainFinishedCommands()).toEqual([]);
    });
});

describe('drainFinishedCommands', () => {

    test('answers with nothing while the command is still running', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        expect(manager.drainFinishedCommands()).toEqual([]);
    });

    test('reports a finished command only once', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1').status).toBe('completed'));
        expect(manager.drainFinishedCommands().map(command => command.id)).toEqual(['bg1']);
        expect(manager.drainFinishedCommands()).toEqual([]);
    });

    test('reports every command that finished since the last drain', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand({id: 'bg1'}), '.agents/a1/session');
        manager.runCommand(newCommand({id: 'bg2'}), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg2').status).toBe('completed'));
        expect(manager.drainFinishedCommands().map(command => command.id).sort()).toEqual(['bg1', 'bg2']);
    });
});
