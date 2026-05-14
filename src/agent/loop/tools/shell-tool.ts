import { exec } from 'child_process';
import { promisify } from 'util';
import process from 'node:process';
const execAsync = promisify(exec);

import { ToolDesc, ToolGuardResult } from '../../definitions/tool-definitions.js';
import { loadAgentConfig } from '@utils';

const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
const timeout = 120;
const trunkcateThreshold = loadAgentConfig<number>('toolResult.truncate.lengthThreshold');

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
    parallelSafe: false,
    invoke: runCommand,
    guard: shellGuard,
}

function shellGuard(input: ShellInput): ToolGuardResult {
    const { command } = input;
    const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/", "del /f /s /q"];
    if (dangerous.some(item => command.includes(item))) {
        return {result: 'denied', reason: 'Dangerous command blocked'};
    }
    return {result: 'allowed'};
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
        return output ? output.slice(0, trunkcateThreshold) : '(no output)';
    } catch (error: any) {
        return error.killed && error.signal === 'SIGTERM' ? `Error: Timeout (${timeout}s)`
            : `Error: ${error.message}`;
    }
}
