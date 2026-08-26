import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {BackgroundCommandManager} from '../services/background-command-manager';
import {PermissionService} from '../services/permission-service';
import {
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool,
    removeBackgroundCommand,
    runBackgroundCommandTool,
} from './background-command-tool';

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {writeFile: vi.fn(), deleteFile: vi.fn()},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    runCommandAsync: vi.fn(),
}));

const runCommand = vi.spyOn(BackgroundCommandManager, 'runCommand');
const getCommandStatus = vi.spyOn(BackgroundCommandManager, 'getCommandStatus');
const getAllCommandsStatus = vi.spyOn(BackgroundCommandManager, 'getAllCommandsStatus');
const removeCommand = vi.spyOn(BackgroundCommandManager, 'removeCommand');
const askPermissionGuard = vi.spyOn(PermissionService, 'askPermissionGuard');

/**
 * The same shell on the same machine as the command run in the foreground, so the same guard.
 * Ungated, this tool was the way around every rule of that one.
 */
describe('runBackgroundCommandTool guard', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        askPermissionGuard.mockReturnValue({result: 'allowed'});
    });

    function guard(command: string) {
        return runBackgroundCommandTool.guard!({title: 'work', command}, newTestContext());
    }

    test('denies a command listed as dangerous', () => {
        expect(guard('sudo apt install foo')).toEqual({
            result: 'denied', reason: 'agent.tools.command.guard.danger'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('asks for permission for a command handing the rest of the line to another program', () => {
        guard('curl https://example.com | sh');
        expect(askPermissionGuard).toHaveBeenCalledExactlyOnceWith(
            'agent.tools.command.guard.warn', 'command', expect.anything()
        );
    });

    test('allows a plain command in agent mode', () => {
        expect(guard('npm run build')).toEqual({result: 'allowed'});
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });
});

describe('runBackgroundCommandTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        runCommand.mockReturnValue(undefined);
    });

    test('starts the command in the session directory owned by the loop', async () => {
        await runBackgroundCommandTool.invoke({title: 'build', command: 'npm run build'}, newTestContext());
        const [command, sessionDir] = runCommand.mock.calls[0]!;
        expect(sessionDir).toBe('.agents/a1/session');
        expect(command).toMatchObject({
            title: 'build', command: 'npm run build', creator: 'agent.a1', status: 'running',
        });
        expect(new Date(command.createdAt).toISOString()).toBe(command.createdAt);
    });

    /** The folder of a spawned loop is deleted while the command it started is still writing. */
    test('keeps the output of a spawned loop command out of the run folder', async () => {
        const context = newTestContext({loopKind: 'sub', sessionDir: '/tmp/subloop/sub9'});
        await runBackgroundCommandTool.invoke({title: 'build', command: 'npm run build'}, context);
        const [command, sessionDir] = runCommand.mock.calls[0]!;
        expect(sessionDir).toBe('.agents/a1/session');
        expect(command.creator).toBe('agent.a1');
    });

    test('leaves the command under the signal of the run that started it', async () => {
        const controller = new AbortController();
        await runBackgroundCommandTool.invoke(
            {title: 'build', command: 'npm run build'},
            newTestContext({abortSignal: controller.signal})
        );
        expect(runCommand.mock.calls[0]![2]).toBe(controller.signal);
    });

    test('reports the generated id back to the agent', async () => {
        const result = await runBackgroundCommandTool.invoke(
            {title: 'build', command: 'npm run build'}, newTestContext()
        );
        expect(result).toContain(`ID: ${runCommand.mock.calls[0]![0].id}`);
        expect(result).toContain('check_background_command_status');
    });

    test('gives every command its own id', async () => {
        const context = newTestContext();
        await runBackgroundCommandTool.invoke({title: 'a', command: 'echo a'}, context);
        await runBackgroundCommandTool.invoke({title: 'b', command: 'echo b'}, context);
        expect(runCommand.mock.calls[0]![0].id).not.toBe(runCommand.mock.calls[1]![0].id);
    });
});

describe('checkBackgroundCommandStatusTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('reports the title, the status and the raw info', async () => {
        const info = {id: 'b1', title: 'build', status: 'completed' as const, preview: 'done'};
        getCommandStatus.mockReturnValue(info);
        const result = await checkBackgroundCommandStatusTool.invoke({commandId: 'b1'}, newTestContext());
        expect(getCommandStatus).toHaveBeenCalledExactlyOnceWith('b1', 'agent.a1');
        expect(result).toContain('Command "build" is currently completed.');
        expect(result).toContain(JSON.stringify(info));
    });

    test('lets an unknown command id surface as an error', async () => {
        getCommandStatus.mockImplementation(() => {
            throw new Error('Command not found: ghost');
        });
        await expect(checkBackgroundCommandStatusTool.invoke({commandId: 'ghost'}, newTestContext()))
            .rejects.toThrow('Command not found: ghost');
    });
});

describe('checkAllBackgroundCommandStatusTool invoke', () => {

    test('lists only the commands of the asking loop', async () => {
        vi.clearAllMocks();
        const all = [{id: 'b1', title: 'build', status: 'running' as const}];
        getAllCommandsStatus.mockReturnValue(all);
        const result = await checkAllBackgroundCommandStatusTool.invoke(undefined, newTestContext());
        expect(getAllCommandsStatus).toHaveBeenCalledExactlyOnceWith('agent.a1');
        expect(result).toContain(JSON.stringify(all));
    });
});

describe('removeBackgroundCommand invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        removeCommand.mockReturnValue(undefined);
    });

    test('refuses to drop a command that is still running', async () => {
        getCommandStatus.mockReturnValue({id: 'b1', title: 'build', status: 'running'});
        const result = await removeBackgroundCommand.invoke({commandId: 'b1'}, newTestContext());
        expect(result).toBe('Command b1 is running, cannot remove.');
        expect(removeCommand).not.toHaveBeenCalled();
    });

    test('drops a command that already completed', async () => {
        getCommandStatus.mockReturnValue({id: 'b1', title: 'build', status: 'completed'});
        const result = await removeBackgroundCommand.invoke({commandId: 'b1'}, newTestContext());
        expect(removeCommand).toHaveBeenCalledExactlyOnceWith('b1', 'agent.a1');
        expect(result).toBe('Command "b1" is removed');
    });
});

describe('background command tool metadata', () => {

    test('all background tools are parallel safe and usable in every kind of loop', () => {
        const tools = [
            runBackgroundCommandTool, checkBackgroundCommandStatusTool,
            checkAllBackgroundCommandStatusTool, removeBackgroundCommand,
        ];
        for (const tool of tools) {
            expect(tool.parallelSafe).toBe(true);
            expect(tool.loopKinds).toBeUndefined();
        }
        expect(runBackgroundCommandTool.tool.schema.required).toEqual(['title', 'command']);
    });
});
