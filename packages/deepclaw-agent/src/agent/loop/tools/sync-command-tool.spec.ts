import {beforeEach, describe, expect, test, vi} from 'vitest';
import {runCommand} from '@deepclaw/node-utils';
import {newTestContext} from '../../../test-support/one-loop-context';
import {PermissionService} from '../services/permission-service';
import {syncCommandTool} from './sync-command-tool';

const mocks = vi.hoisted(() => ({
    runCommand: vi.fn<(command: string) => Promise<{output: string, preview: string}>>(),
}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    runCommand: mocks.runCommand,
}));

const askPermissionGuard = vi.spyOn(PermissionService, 'askPermissionGuard');

function guard(command: string, mode: 'agent' | 'chat' = 'agent') {
    const context = newTestContext();
    context.loopConfig.mode = mode;
    return syncCommandTool.guard!({command}, context);
}

describe('syncCommandTool guard', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        askPermissionGuard.mockReturnValue({result: 'allowed'});
    });

    test('denies a command listed as dangerous', () => {
        expect(guard('sudo apt install foo')).toEqual({
            result: 'denied', reason: 'agent.tools.syncCommand.guard.danger'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('denies a command that wipes the root directory', () => {
        expect(guard('rm -rf /').result).toBe('denied');
    });

    test('asks for permission for a command with shell metacharacters', () => {
        guard('ls | wc -l');
        expect(askPermissionGuard).toHaveBeenCalledExactlyOnceWith(
            'agent.tools.syncCommand.guard.warn', 'command', 'agent.a1', 'agent'
        );
    });

    test('asks for permission when the loop is not running in agent mode', () => {
        guard('ls -l', 'chat');
        expect(askPermissionGuard).toHaveBeenCalledExactlyOnceWith(
            'agent.tools.syncCommand.guard.mode', 'command', 'agent.a1', 'agent'
        );
    });

    test('allows a plain command in agent mode', () => {
        expect(guard('ls -l')).toEqual({result: 'allowed'});
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });
});

describe('syncCommandTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('returns the preview of the command output', async () => {
        vi.mocked(runCommand).mockResolvedValue({output: 'full output', preview: 'short output'});
        const result = await syncCommandTool.invoke({command: 'echo hi'}, newTestContext());
        expect(runCommand).toHaveBeenCalledExactlyOnceWith('echo hi');
        expect(result).toBe('short output');
    });

    test('reports a dedicated message when the command printed nothing', async () => {
        vi.mocked(runCommand).mockResolvedValue({output: '', preview: ''});
        const result = await syncCommandTool.invoke({command: 'true'}, newTestContext());
        expect(result).toBe('agent.tools.syncCommand.empty');
    });

    test('reports a timeout when the child process was killed', async () => {
        vi.mocked(runCommand).mockRejectedValue(Object.assign(new Error('timed out'), {
            killed: true, signal: 'SIGTERM'
        }));
        const result = await syncCommandTool.invoke({command: 'sleep 999'}, newTestContext());
        expect(result).toBe('agent.tools.syncCommand.timeout');
    });

    test('reports any other command failure', async () => {
        vi.mocked(runCommand).mockRejectedValue(new Error('exit 127'));
        const result = await syncCommandTool.invoke({command: 'nope'}, newTestContext());
        expect(result).toBe('agent.tools.syncCommand.error');
    });
});

describe('syncCommandTool metadata', () => {

    test('is not parallel safe and requires a command', () => {
        expect(syncCommandTool.parallelSafe).toBe(false);
        expect(syncCommandTool.tool.schema.required).toEqual(['command']);
        expect(syncCommandTool.agentMode).toEqual(['agent']);
    });
});
