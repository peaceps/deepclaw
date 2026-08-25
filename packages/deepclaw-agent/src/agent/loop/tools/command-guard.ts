import { i18nInstance } from '@deepclaw/i18n';
import { COMMAND_SEPARATORS, readCommand } from '@deepclaw/node-utils';
import { ToolGuardResult } from '../../definitions/tool-definitions';
import { OneLoopContext } from '../../definitions/definitions';
import { PermissionService } from '../services/permission-service';

const rules: {deny: (string | RegExp)[], warning: (string | RegExp)[]} = {
    deny: [
        'rm -rf /',
        'sudo',
        'shutdown',
        'reboot',
        '> /dev/',
        /\bIFS\s*=/,
        'del /f /s /q'
    ],
    warning: [
        /\bsudo\b/,
        /\brm\s+(-[a-zA-Z]*)?r/
    ]
};

/**
 * Programs a line may be made of and still not be asked about. A name here is not a program judged
 * harmless: it is one that meeting in a line of several commands is not news. What the list decides
 * is what the user is told about and never what a run can do, a lone command of any name running
 * unasked, so whatever an unremarkable line does, two calls would have done in silence.
 *
 * That is also why it buys a program nothing on its own. It buys a line holding several: a pipe or
 * an "and" is what makes a line worth asking about, since what follows one is no longer the command
 * that was read, and a line of nothing but these is still nothing but these.
 *
 * Written as they are called on the path, a path of somebody's own ending in a name of ours being
 * a program we know nothing about.
 *
 * agent-browser drives a browser one command at a time and its own documentation pipes one into
 * the next, so the skill deepclaw ships for it costs a prompt a step otherwise. cd starts no
 * program at all, and moving the shell to a folder before running something there is the commonest
 * reason a line has an "and" in it; what it buys is a program of this list run somewhere else,
 * which that program could be told to do in its own arguments anyway. The readers read and report
 * and write nothing, under both names where the two shells disagree on one. The ones that ask the
 * machine and the network what they are doing are not all of that kind and are here regardless:
 * route and ipconfig can change what happens to a packet, tcpdump writes the capture to a file and
 * can be told to run a command as it rolls one, nmap runs scripts of its own.
 *
 * Two kinds of name do not belong here. One is anything that carries a value into the command after
 * it, an export or a set being able to name the very path the next program is looked up on, which
 * does change what the rest of the line runs. The other is a program that is a window rather than a
 * command: a run waiting on a window it cannot see waits until the command is killed for taking too
 * long, and not asking about it saves nobody anything.
 *
 * Where a line writes is no part of any of this. A redirect belongs to the line rather than to a
 * program on it, and a path handed to a program as an argument is a path like any other word; no
 * rule here has ever looked at either, so a line of these names reaches a file exactly as far as a
 * lone command always could. The tool that reaches for a path by itself asks when the path leaves
 * the working folder (see fileGuard), and that is a rule about tools rather than about shells: the
 * day it is wanted here too, it has to be written to read a line of several commands, or it will be
 * a rule these names walk straight past.
 */
const UNREMARKABLE_PROGRAMS = [
    'agent-browser',
    'cd',
    'pwd', 'ls', 'dir', 'echo', 'cat', 'type', 'head', 'tail', 'wc', 'grep', 'findstr', 'jq',
    'tasklist', 'netstat', 'ipconfig', 'route', 'ping', 'tracert', 'nslookup', 'dig', 'whois',
    'host', 'nmap', 'tcpdump'
];

/**
 * What both command tools ask before running anything. The deny list is final; everything else is
 * a question for the user, and a question is asked once per loop at most (see PermissionService).
 */
export function commandGuard(command: string, context: OneLoopContext): ToolGuardResult {
    if (checkRules(rules.deny, command)) {
        return {
            result: 'denied',
            reason: i18nInstance.t('agent.tools.command.guard.danger', {command})
        };
    }
    if (checkRules(rules.warning, command) || !shellOnlyRuns(command)) {
        return ask('warn', command, context);
    }
    if (context.loopConfig.mode !== 'agent') {
        return ask('mode', command, context);
    }
    return {result: 'allowed'};
}

/**
 * Whether the line does no more than run programs nobody needs to be told about. A dollar or a
 * backtick the shell reads for itself stands for a command nobody here can read, so a line holding
 * one is a line nobody can vouch for, unremarkable programs or not.
 */
function shellOnlyRuns(command: string): boolean {
    const {acted, programs} = readCommand(command);
    if (acted.some(char => !COMMAND_SEPARATORS.includes(char))) {
        return false;
    }
    return acted.length === 0
        || programs.every(program => UNREMARKABLE_PROGRAMS.includes(program));
}

function ask(reason: 'warn' | 'mode', command: string, context: OneLoopContext): ToolGuardResult {
    return PermissionService.askPermissionGuard(
        i18nInstance.t(`agent.tools.command.guard.${reason}`, {command}),
        'command', context.permissionWhiteList
    );
}

function checkRules(rules: (string | RegExp)[], command: string): string {
    const danger = rules.find(rule => typeof rule === 'string' ? command.includes(rule) : rule.test(command));
    if (danger) {
        return typeof danger === 'string' ? danger : danger.source;
    }
    return '';
}
