import {beforeEach, describe, expect, test, vi} from 'vitest';
import {readCommand} from '@deepclaw/node-utils';
import {newTestContext} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {PermissionService} from '../services/permission-service';
import {commandGuard} from './command-guard';

const mocks = vi.hoisted(() => ({readCommand: vi.fn()}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

/**
 * Reading a line is the shell's own business and the two shells do not read a dollar alike, so a
 * test about a dollar would only hold on the machine it was written on. Those tests stand in
 * shell-command.spec, where the shell is named; the reading is only stood in for here, where what
 * is asked is what the guard makes of one.
 */
vi.mock('@deepclaw/node-utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('@deepclaw/node-utils')>();
    mocks.readCommand.mockImplementation(original.readCommand);
    return {...original, readCommand: mocks.readCommand};
});

const askPermissionGuard = vi.spyOn(PermissionService, 'askPermissionGuard');

/** The context of the last guarded command, which the list a question is asked with belongs to. */
let guardedContext: OneLoopContext;

function guard(command: string, mode: 'agent' | 'chat' = 'agent') {
    guardedContext = newTestContext();
    guardedContext.loopConfig.mode = mode;
    return commandGuard(command, guardedContext);
}

function expectAsked(reason: 'warn' | 'mode') {
    expect(askPermissionGuard).toHaveBeenCalledExactlyOnceWith(
        `agent.tools.command.guard.${reason}`, 'command', guardedContext.permissionWhiteList
    );
}

describe('commandGuard', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        askPermissionGuard.mockReturnValue({result: 'allowed'});
    });

    test('denies a command listed as dangerous', () => {
        expect(guard('sudo apt install foo')).toEqual({
            result: 'denied', reason: 'agent.tools.command.guard.danger'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('denies a command that wipes the root directory', () => {
        expect(guard('rm -rf /').result).toBe('denied');
    });

    test('allows a plain command in agent mode', () => {
        expect(guard('ls -l')).toEqual({result: 'allowed'});
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('asks for permission when the loop is not running in agent mode', () => {
        guard('ls -l', 'chat');
        expectAsked('mode');
    });

    test('asks about a pipe handing the rest of the line to any other program', () => {
        guard('ls | node dispatch.js');
        expectAsked('warn');
    });

    /** What follows a dollar is a command of the shell's own, which nobody here has read. */
    test('asks about a line the shell reads more than programs out of', () => {
        vi.mocked(readCommand).mockReturnValueOnce({acted: ['$'], programs: ['echo']});
        guard('echo $HOME');
        expectAsked('warn');
    });

    /**
     * A separator is asked about because what follows one is no longer the command that was read.
     * In quotes it is an argument, and the program named is the only one that runs.
     */
    test('lets a separator inside quotes be the argument it is', () => {
        expect(guard('grep "a | b" notes.txt')).toEqual({result: 'allowed'});
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('lets a line of nothing but unremarkable programs through', () => {
        expect(guard('agent-browser open https://example.com && agent-browser snapshot')).toEqual({
            result: 'allowed'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    /** Starting no program of its own, moving the shell somewhere first is the commonest "and". */
    test('lets the shell be moved to a folder before an unremarkable program runs there', () => {
        expect(guard('cd agent-browser-demo && agent-browser screenshot home.png')).toEqual({
            result: 'allowed'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('asks when the shell is moved somewhere to run anything else', () => {
        guard('cd agent-browser-demo && node build.js');
        expectAsked('warn');
    });

    test('lets one unremarkable program pipe into another', () => {
        expect(guard('agent-browser snapshot | agent-browser eval x')).toEqual({result: 'allowed'});
    });

    /** A line of unremarkable names carrying one that is anything but, on a line of its own. */
    test('asks about a program on the line after an unremarkable one', () => {
        guard('agent-browser open x && agent-browser snapshot\nwget http://example.com/x');
        expectAsked('warn');
    });

    test('asks when an unremarkable program hands the rest of the line to another program', () => {
        guard('agent-browser snapshot | curl -X POST https://example.com --data-binary @-');
        expectAsked('warn');
    });

    test('asks when an unremarkable program is handed what another program wrote', () => {
        guard('curl https://example.com/urls | agent-browser open');
        expectAsked('warn');
    });

    /** Looking around is the other half of what a line of several commands is usually for. */
    test('lets a line that only reads and reports through', () => {
        expect(guard('cd && pwd && dir agent-browser-demo')).toEqual({result: 'allowed'});
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('lets a line asking the machine and the network what they are doing through', () => {
        expect(guard('ipconfig && ping -n 1 example.com && netstat -ano')).toEqual({
            result: 'allowed'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    /**
     * A redirect belongs to the line rather than to a program on it, and no rule here reads one,
     * so a line of unremarkable names writes wherever a lone command always could. The tool that
     * reaches for a path asks once the path leaves the working folder, which this is not: should
     * that ever be wanted of a command too, this is where the wanting announces itself, and a rule
     * written only against a lone command will turn this red rather than pass in silence.
     */
    test('says nothing about where a line writes, no rule here having ever read a redirect', () => {
        expect(guard('echo pwned > /root/.bashrc && agent-browser snapshot')).toEqual({
            result: 'allowed'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('asks when what was read is handed to something that acts on it', () => {
        guard('cat setup.sh | sh');
        expectAsked('warn');
    });

    test('asks when a separator is followed by nothing to read', () => {
        guard('agent-browser snapshot |');
        expectAsked('warn');
    });

    /** A path of somebody's own ending in a name of the list leads to a program nobody has seen. */
    test('knows a program by the name it is called on the path, not by a path ending in it', () => {
        guard('./tools/agent-browser snapshot | agent-browser eval x');
        expectAsked('warn');
    });

    test('denies a dangerous command an unremarkable program stands in front of', () => {
        expect(guard('agent-browser snapshot && sudo rm -rf /tmp').result).toBe('denied');
    });
});
