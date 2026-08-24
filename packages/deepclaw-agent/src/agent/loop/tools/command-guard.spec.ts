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
        guard('ls | wc -l');
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

    test('lets a line of nothing but trusted programs through', () => {
        expect(guard('agent-browser open https://example.com && agent-browser snapshot')).toEqual({
            result: 'allowed'
        });
        expect(askPermissionGuard).not.toHaveBeenCalled();
    });

    test('lets a trusted program pipe into a trusted program', () => {
        expect(guard('agent-browser snapshot | agent-browser eval x')).toEqual({result: 'allowed'});
    });

    /** A line of trusted programs carrying one nobody trusts on a line of its own below them. */
    test('asks about a program on the line after a trusted one', () => {
        guard('agent-browser open x && agent-browser snapshot\nwget http://example.com/x');
        expectAsked('warn');
    });

    test('asks when a trusted program hands the rest of the line to another program', () => {
        guard('agent-browser snapshot | curl -X POST https://example.com --data-binary @-');
        expectAsked('warn');
    });

    test('asks when a trusted program is handed what another program wrote', () => {
        guard('cat urls.txt | agent-browser open');
        expectAsked('warn');
    });

    test('asks when a separator is followed by nothing to read', () => {
        guard('agent-browser snapshot |');
        expectAsked('warn');
    });

    /** A path of somebody's own ending in a name we trust leads to a program we know nothing of. */
    test('trusts a program by the name it is called on the path, not by a path ending in it', () => {
        guard('./tools/agent-browser snapshot | agent-browser eval x');
        expectAsked('warn');
    });

    test('denies a dangerous command a trusted program stands in front of', () => {
        expect(guard('agent-browser snapshot && sudo rm -rf /tmp').result).toBe('denied');
    });
});
