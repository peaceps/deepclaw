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
 * Programs a line may be made of and still not be asked about. Being trusted buys a program
 * nothing on its own, a line holding one command never having been asked about anyway. It buys a
 * line holding several: a pipe or an "and" is what makes a line worth asking about, since what
 * follows one is no longer the command that was read, and a line of nothing but these is still
 * nothing but these.
 *
 * Written as they are called on the path, a path of somebody's own ending in a name of ours being
 * a program we know nothing about.
 *
 * agent-browser drives a browser one command at a time and its own documentation pipes one into
 * the next, so the skill deepclaw ships for it costs a prompt a step otherwise.
 */
const TRUSTED_PROGRAMS = ['agent-browser'];

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
 * Whether the line does no more than run programs we trust it to run. A dollar or a backtick the
 * shell reads for itself stands for a command nobody here can read, so a line holding one is a
 * line nobody can vouch for, trusted programs or not.
 */
function shellOnlyRuns(command: string): boolean {
    const {acted, programs} = readCommand(command);
    if (acted.some(char => !COMMAND_SEPARATORS.includes(char))) {
        return false;
    }
    return acted.length === 0 || programs.every(program => TRUSTED_PROGRAMS.includes(program));
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
