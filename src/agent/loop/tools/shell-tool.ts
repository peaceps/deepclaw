import { exec } from 'child_process';
import { promisify } from 'util';
import process from 'node:process';
const execAsync = promisify(exec);
import i18n from 'i18next';

import { ToolDesc, ToolGuardResult, askPermissionGuard } from '../../definitions/tool-definitions.js';
import { DeepclawConfig, loadAgentConfig } from '@utils';

const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
const timeout = 120;
const trunkcateThreshold = loadAgentConfig<number>('toolResult.truncate.lengthThreshold');
const agentMode = loadAgentConfig<DeepclawConfig['agent']['mode']>('mode');

type ShellInput = {
    command: string;
}

export const shellTool: ToolDesc<ShellInput> = {
    tool: {
        name: 'shell',
        description: 'Run a shell command in the current workspace. This is local function tool, not MCP compatible.',
        schema: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {command: {type: 'string'}},
            required: ['command'],
        },
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    invoke: runCommand,
    guard: shellGuard,
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

function shellGuard(input: ShellInput): ToolGuardResult {
    const { command } = input;
    const denied = checkRules(rules.deny, command);
    if (denied) {
        return {result: 'denied', reason: i18n.t('agent.tools.shell.guard.danger', {command: denied})};
    }
    const warned = checkRules(rules.warning, command);
    if (warned) {
        return askPermissionGuard(i18n.t('agent.tools.shell.guard.warn', {command: warned}));
    }
    if (agentMode !== 'agent') {
        return askPermissionGuard(i18n.t('agent.tools.shell.guard.mode', {command: command}));
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

async function runCommand(input: ShellInput): Promise<string> {
    const { command } = input;
    const options = {
        timeout: timeout * 1000,
        maxBuffer: 50 * 1024 * 1024,
        cwd: process.cwd(),
        shell,
        windowsHide: true,
    };

    try {
        const { stdout, stderr } = await execAsync(command, options);
        const output = (stdout + stderr).trim();
        return output ? output.slice(0, trunkcateThreshold) : i18n.t('agent.tools.shell.empty');
    } catch (error: any) {
        return error?.killed && error?.signal === 'SIGTERM' ? i18n.t('agent.tools.shell.timeout', {timeout})
            : i18n.t('agent.tools.shell.error', {message: error?.message || ''});
    }
}
