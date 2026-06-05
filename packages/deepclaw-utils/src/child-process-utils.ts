import { exec } from 'child_process';
import { promisify } from 'util';
import process from 'node:process';
import chardet from 'chardet';
import iconv from 'iconv-lite';
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
        encoding: 'buffer',
    };
    return execAsync(command, options).then(({ stdout, stderr }) => {
        const output = handleOutput(stdout);
        const error = handleOutput(stderr);
        return [output, error].filter(Boolean).join('\n').trim();
    }).then((output: string) => {
        const preview = output.slice(0, trunkcateThreshold);
        return { output, preview };
    });
}

function handleOutput(stdout: string | Buffer<ArrayBuffer>): string {
    return typeof stdout === 'string' ? stdout : decodeBuffer(stdout);
}

function decodeBuffer(buffer: Buffer<ArrayBuffer>): string {
    const encoding = chardet.detect(buffer);
    let text: string;
    if (encoding && iconv.encodingExists(encoding)) {
      text = iconv.decode(buffer, encoding);
    } else {
      text = tryCommonEncodings(buffer);
    }
    return text;
}

function tryCommonEncodings(buffer: Buffer): string {
    const encodings = ['gbk', 'utf-8', 'big5', 'shift_jis', 'euc-kr'];
    for (const enc of encodings) {
      try {
        const decoded = iconv.decode(buffer, enc);
        if (!decoded.includes('�')) return decoded;
      } catch (e) {
        continue;
      }
    }
    return buffer.toString('utf8');
}
