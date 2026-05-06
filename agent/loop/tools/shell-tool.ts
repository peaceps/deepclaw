import { exec } from 'child_process';
import { promisify } from 'util';
import process from 'node:process';
const execAsync = promisify(exec);

import { ToolDesc } from './tool-definitions.js';

type ShellInput = {
    command: string;
}

export const shellTool: ToolDesc<ShellInput> = {
    tool: {
        name: 'shell',
        description: 'Run a shell command in the current workspace.',
        input_schema: {
            type: 'object' as const,
            properties: {command: {type: 'string'}},
            required: ['command'],
        },
    },
    invoke: runCommand
}

async function runCommand(input: ShellInput): Promise<string> {
    const { command } = input;
    // 1. 危险命令黑名单检查
    const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/", "del /f /s /q"];
    if (dangerous.some(item => command.includes(item))) {
        return "Error: Dangerous command blocked";
    }

    // 2. 执行命令的配置项
    const shell = process.platform === 'win32'
        ? (process.env['ComSpec'] || 'cmd.exe')
        : '/bin/bash';
    const options = {
        timeout: 120000,          // 120 秒（毫秒）
        maxBuffer: 50 * 1024 * 1024, // 50 MB 缓冲区，避免输出过大导致崩溃
        cwd: process.cwd(),       // 使用当前工作目录
        shell,
        windowsHide: true,
    };

    try {
        // 3. 执行命令并捕获输出
        const { stdout, stderr } = await execAsync(command, options);
        const output = (stdout + stderr).trim();
        return output ? output.slice(0, 50000) : "(no output)";
    } catch (error: any) {
        // 4. 命令执行失败（非零退出码）但仍有输出 → 模仿 Python 行为，返回输出内容
        if (error.stdout || error.stderr) {
            const output = (error.stdout + error.stderr).trim();
            return output ? output.slice(0, 50000) : "(no output)";
        }

        // 5. 超时错误检测
        if (error.killed && error.signal === 'SIGTERM') {
            return "Error: Timeout (120s)";
        }

        // 6. 其他错误（文件未找到、权限等）
        return `Error: ${error.message}`;
    }
}

