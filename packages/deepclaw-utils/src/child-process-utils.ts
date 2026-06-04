import { exec } from 'child_process';
import { promisify } from 'util';
import process from 'node:process';
const execAsync = promisify(exec);

const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
export const childProcessTimeout = 120;
const trunkcateThreshold = 20000;

export async function runCommand(command: string): Promise<{output: string, preview: string}> {
    return await runCommandAsync(command);
}

export function runCommandAsync(command: string): Promise<{output: string, preview: string}> {
    const options = {
        timeout: childProcessTimeout * 1000,
        maxBuffer: 50 * 1024 * 1024,
        cwd: process.cwd(),
        shell,
        windowsHide: true,
    };
    return execAsync(command, options).then(({ stdout, stderr }) => {
        const output = ((stdout || '') + (stderr || '')).trim();
        const preview = output.slice(0, trunkcateThreshold);
        return { output, preview };
    });
}