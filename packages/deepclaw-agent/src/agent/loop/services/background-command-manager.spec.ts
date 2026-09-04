import {describe, expect, test, vi} from 'vitest';
import {type BackgroundCommand} from './background-command-manager';

const mocks = vi.hoisted(() => ({
    runCommandAsync: vi.fn<
        (command: string, signal?: AbortSignal) => Promise<{output: string, preview: string}>
    >(),
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

/** The loop a command belongs to; the manager only ever answers to its owner. */
const OWNER = 'a1';

function newCommand(overrides: Partial<BackgroundCommand> = {}): BackgroundCommand {
    return {
        id: 'bg1',
        title: 'build the app',
        command: 'npm run build',
        createdAt: '2024-01-01T00:00:00.000Z',
        status: 'running',
        creator: OWNER,
        ...overrides,
    };
}

describe('runCommand', () => {

    test('registers the command under the background folder of the session', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        expect(manager.getCommandStatus('bg1', OWNER)).toEqual({
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
        expect(mocks.runCommandAsync)
            .toHaveBeenCalledExactlyOnceWith('sleep 1', undefined, undefined);
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('hands the signal of the run down to the command', async () => {
        const manager = await loadManager();
        const controller = new AbortController();
        manager.runCommand(newCommand(), '.agents/a1/session', controller.signal);
        expect(mocks.runCommandAsync)
            .toHaveBeenCalledWith('npm run build', controller.signal, undefined);
    });

    /** The folder the run that asked for it works in, a background command being that run's own. */
    test('starts the command in the folder it was given', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session', undefined, '/home/someone/code/app');
        expect(mocks.runCommandAsync)
            .toHaveBeenCalledWith('npm run build', undefined, '/home/someone/code/app');
    });

    test('reads back as stopped rather than as broken when the run was stopped', async () => {
        const manager = await loadManager();
        const controller = new AbortController();
        mocks.runCommandAsync.mockRejectedValue(new Error('The operation was aborted'));
        controller.abort();
        manager.runCommand(newCommand(), '.agents/a1/session', controller.signal);
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        expect(manager.getCommandStatus('bg1', OWNER).preview)
            .toBe('The user stopped the run that started this command, so it did not finish.');
    });

    test('still reads back as an error when the run was never stopped', async () => {
        const manager = await loadManager();
        const controller = new AbortController();
        mocks.runCommandAsync.mockRejectedValue(new Error('command exploded'));
        manager.runCommand(newCommand(), '.agents/a1/session', controller.signal);
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        expect(manager.getCommandStatus('bg1', OWNER).preview).toBe('Error: command exploded');
    });

    test('stores the output and the preview once the command succeeds', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'full output', preview: 'full...'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        expect(manager.getCommandStatus('bg1', OWNER).preview).toBe('full...');
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/a1/session/background_commands/bg1.bgout', 'full output'
        );
    });

    test('keeps the path the writer answered with', async () => {
        const manager = await loadManager();
        mocks.writeFile.mockReturnValue('sanitized/bg1.bgout');
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        expect(manager.getCommandStatus('bg1', OWNER).outputPath).toBe('sanitized/bg1.bgout');
    });

    test('reports a failing command as completed with the error text', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockRejectedValue(new Error('command exploded'));
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        expect(manager.getCommandStatus('bg1', OWNER).preview).toBe('Error: command exploded');
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/a1/session/background_commands/bg1.bgout', 'Error: command exploded'
        );
    });

    test('falls back to an unknown error when the failure carries no message', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockRejectedValue(undefined);
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        expect(manager.getCommandStatus('bg1', OWNER).preview).toBe('Error: Unknown error');
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
        expect(manager.getAllCommandsStatus(OWNER)).toHaveLength(1);
        expect(manager.getCommandStatus('bg1', OWNER).title).toBe('run the tests');
    });
});

describe('getCommandStatus', () => {

    test('fails for an id that was never registered', async () => {
        const manager = await loadManager();
        expect(() => manager.getCommandStatus('ghost', OWNER)).toThrow('Command not found: ghost');
    });

    test('hides the command line and the creator from the reported status', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        expect(Object.keys(manager.getCommandStatus('bg1', OWNER)).sort())
            .toEqual(['id', 'outputPath', 'preview', 'status', 'title']);
    });

    test('does not admit that a command of another loop exists', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        expect(() => manager.getCommandStatus('bg1', 'a2')).toThrow('Command not found: bg1');
    });
});

describe('getAllCommandsStatus', () => {

    test('answers with an empty list when nothing was started', async () => {
        const manager = await loadManager();
        expect(manager.getAllCommandsStatus(OWNER)).toEqual([]);
    });

    test('reports every registered command', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand({id: 'bg1'}), '.agents/a1/session');
        manager.runCommand(newCommand({id: 'bg2'}), '.agents/a1/session');
        expect(manager.getAllCommandsStatus(OWNER).map(command => command.id)).toEqual(['bg1', 'bg2']);
    });

    test('leaves out the commands of the other loops', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand({id: 'bg1'}), '.agents/a1/session');
        manager.runCommand(newCommand({id: 'bg2', creator: 'a2'}), '.agents/a2/session');
        expect(manager.getAllCommandsStatus(OWNER).map(command => command.id)).toEqual(['bg1']);
        expect(manager.getAllCommandsStatus('a2').map(command => command.id)).toEqual(['bg2']);
    });
});

describe('removeCommand', () => {

    test('forgets the command and deletes its output file', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        manager.removeCommand('bg1', OWNER);
        expect(mocks.deleteFile)
            .toHaveBeenCalledExactlyOnceWith('.agents/a1/session/background_commands/bg1.bgout');
        expect(() => manager.getCommandStatus('bg1', OWNER)).toThrow('Command not found: bg1');
    });

    test('does nothing for an unknown id', async () => {
        const manager = await loadManager();
        manager.removeCommand('ghost', OWNER);
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });

    test('keeps the command of another loop', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        manager.removeCommand('bg1', 'a2');
        expect(mocks.deleteFile).not.toHaveBeenCalled();
        expect(manager.getCommandStatus('bg1', OWNER).id).toBe('bg1');
    });

    test('also drops the command from the finished queue', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        manager.removeCommand('bg1', OWNER);
        expect(manager.drainFinishedCommands(OWNER)).toEqual([]);
    });
});

describe('drainFinishedCommands', () => {

    test('answers with nothing while the command is still running', async () => {
        const manager = await loadManager();
        manager.runCommand(newCommand(), '.agents/a1/session');
        expect(manager.drainFinishedCommands(OWNER)).toEqual([]);
    });

    test('reports a finished command only once', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand(), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg1', OWNER).status).toBe('completed'));
        expect(manager.drainFinishedCommands(OWNER).map(command => command.id)).toEqual(['bg1']);
        expect(manager.drainFinishedCommands(OWNER)).toEqual([]);
    });

    test('reports every command that finished since the last drain', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand({id: 'bg1'}), '.agents/a1/session');
        manager.runCommand(newCommand({id: 'bg2'}), '.agents/a1/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg2', OWNER).status).toBe('completed'));
        expect(manager.drainFinishedCommands(OWNER).map(command => command.id).sort()).toEqual(['bg1', 'bg2']);
    });

    /** Draining another loop's command would report it to a stranger and lose it for its owner. */
    test('keeps a finished command waiting for the loop that started it', async () => {
        const manager = await loadManager();
        mocks.runCommandAsync.mockResolvedValue({output: 'done', preview: 'done'});
        manager.runCommand(newCommand({id: 'bg1'}), '.agents/a1/session');
        manager.runCommand(newCommand({id: 'bg2', creator: 'a2'}), '.agents/a2/session');
        await vi.waitFor(() => expect(manager.getCommandStatus('bg2', 'a2').status).toBe('completed'));
        expect(manager.drainFinishedCommands(OWNER).map(command => command.id)).toEqual(['bg1']);
        expect(manager.drainFinishedCommands('a2').map(command => command.id)).toEqual(['bg2']);
    });
});
