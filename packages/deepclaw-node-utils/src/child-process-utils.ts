import { exec } from 'child_process';
import { promisify } from 'util';
import process from 'node:process';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import { FileUtils } from './file-utils';
const execAsync = promisify(exec);

const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
export const childProcessTimeout = 120;
const trunkcateThreshold = 20000;

/**
 * A command run and waited on, answered with the whole of what it printed. The preview is not
 * offered here on purpose: it is cut to the very length above which a caller files an answer away
 * and hands back a path, so it arrives just under that line and is passed on whole and cut, with
 * nothing filed and nothing saying anything was lost. A caller that wants a preview wants a path
 * beside it, which is what runCommandAsync gives the background commands.
 */
export async function runCommand(
    command: string, signal?: AbortSignal, cwd?: string
): Promise<{output: string}> {
    const {output} = await runCommandAsync(command, signal, cwd);
    return {output};
}

/**
 * The signal reaches the shell this runs the command in, and no further. On linux and mac that is
 * enough for the ordinary case, where the shell passes the death of itself on to what it started.
 * Windows has no process group to kill, so a grandchild there usually outlives the shell and keeps
 * running with nobody waiting on it: a stop is answered at once either way, but on Windows what it
 * stopped is the waiting rather than always the work.
 */
export function runCommandAsync(
    command: string, signal?: AbortSignal, cwd?: string
): Promise<{output: string, preview: string}> {
    const options = {
        timeout: childProcessTimeout * 1000,
        maxBuffer: 50 * 1024 * 1024,
        // A relative path in a command means what it means everywhere else, the data root. The web
        // ui is a server started from wherever it was installed, and a run of it that wrote its
        // work beside that installation would have written it out of reach of the whole app.
        //
        // A caller with a folder of its own names it: the work of a project given one happens
        // there, and a command of that work starting anywhere else is a command run beside the
        // files it is about. Whoever names it has asked whether it is still a folder that is
        // there -- a cwd that is not is a command that never starts, and the answer to that says
        // the machine broke rather than that a folder was moved.
        cwd: cwd || FileUtils.getWorkingDir(),
        shell,
        windowsHide: true,
        encoding: 'buffer',
        signal,
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
      } catch {
        // TODO handle error
        continue;
      }
    }
    return buffer.toString('utf8');
}
