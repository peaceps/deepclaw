import { i18nInstance } from '@deepclaw/i18n';
import { runCommand, childProcessTimeout} from '@deepclaw/utils';

import { ToolDesc, ToolGuardResult, askPermissionGuard } from '../../definitions/tool-definitions';
import { DeepclawConfig } from '@deepclaw/config';

type SyncCommandInput = {
    command: string;
}

export const syncCommandTool: ToolDesc<SyncCommandInput> = {
    tool: {
        name: 'run_sync_command',
        description: `Run a command such as a shell command in the current workspace in a child process.
Will return the output of the command. This is local function tool, not MCP compatible.`,
        schema: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {command: {type: 'string'}},
            required: ['command'],
        },
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    invoke: execute,
    guard: syncCommandGuard,
}

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
        /[;&|$]/,
        /\bsudo\b/,
        /\brm\s+(-[a-zA-Z]*)?r/,
        /\$\(/
    ]
};

function syncCommandGuard(input: SyncCommandInput, agentMode: DeepclawConfig['agents'][0]['mode']): ToolGuardResult {
    const { command } = input;
    const denied = checkRules(rules.deny, command);
    if (denied) {
        return {result: 'denied', reason: i18nInstance.t('agent.tools.syncCommand.guard.danger', {command})};
    }
    const warned = checkRules(rules.warning, command);
    if (warned) {
        return askPermissionGuard(i18nInstance.t('agent.tools.syncCommand.guard.warn', {command}));
    }
    if (agentMode !== 'agent') {
        return askPermissionGuard(i18nInstance.t('agent.tools.syncCommand.guard.mode', {command}));
    }
    return {result: 'allowed'};
}

function checkRules(rules: (string | RegExp)[], command: string): string {
    const danger = rules.find(rule => typeof rule === 'string' ? command.includes(rule) : rule.test(command));
    if (danger) {
        return typeof danger === 'string' ? danger : danger.source;
    }
    return '';
}

async function execute(input: SyncCommandInput): Promise<string> {
    const { command } = input;
    try {
        const { preview } = await runCommand(command);
        return !preview ? i18nInstance.t('agent.tools.syncCommand.empty'): preview;
    } catch (error: any) {
        return error?.killed && error?.signal === 'SIGTERM' ? i18nInstance.t('agent.tools.syncCommand.timeout', {childProcessTimeout})
            : i18nInstance.t('agent.tools.syncCommand.error', {message: error?.message || ''});
    }
}
