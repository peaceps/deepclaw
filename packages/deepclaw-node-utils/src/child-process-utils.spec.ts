import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {childProcessTimeout, runCommand, runCommandAsync} from './child-process-utils';

describe('runCommandAsync', () => {

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    /**
     * The web ui is a server started from wherever it was installed, so a relative path in a
     * command has to be read against the data root the rest of the app reads it against.
     */
    test('runs where the data root is, not where the process was started', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'deepclaw-cwd-'));
        vi.stubEnv('DEEPCLAW_HOME', home);
        try {
            const {output} = await runCommandAsync(`node -e "process.stdout.write(process.cwd())"`);
            expect(fs.realpathSync(output)).toBe(fs.realpathSync(home));
        } finally {
            fs.rmSync(home, {recursive: true, force: true});
        }
    });

    test('returns the trimmed stdout of the command', async () => {
        const {output} = await runCommandAsync('echo deepclaw');
        expect(output).toBe('deepclaw');
    });

    test('mirrors output into preview when the output is short', async () => {
        const {output, preview} = await runCommandAsync('echo deepclaw');
        expect(preview).toBe(output);
    });

    test('truncates the preview at 20000 characters while keeping the full output', async () => {
        const {output, preview} = await runCommandAsync(`node -e "process.stdout.write('x'.repeat(30000))"`);
        expect(output).toHaveLength(30000);
        expect(preview).toHaveLength(20000);
    });

    test('reports stderr as output when the command still succeeds', async () => {
        const {output} = await runCommandAsync(`node -e "process.stderr.write('boom')"`);
        expect(output).toBe('boom');
    });

    test('joins stdout and stderr with a newline', async () => {
        const {output} = await runCommandAsync(
            `node -e "process.stdout.write('out'); process.stderr.write('err')"`
        );
        expect(output).toBe('out\nerr');
    });

    test('rejects instead of resolving when the command exits non zero', async () => {
        await expect(runCommandAsync('exit 1')).rejects.toThrow();
    });
});

describe('runCommand', () => {

    test('runs the command as runCommandAsync does', async () => {
        const {output} = await runCommandAsync('echo deepclaw');
        expect(await runCommand('echo deepclaw')).toEqual({output});
    });

    /**
     * A preview is cut to the very length above which a caller files an output away and answers
     * with a path to it, so one handed on unchanged reads as an output that fit, and the tail of a
     * long one goes missing with nothing left to say it was ever there. Whoever wants a preview
     * wants a path beside it, which is runCommandAsync and the background commands it serves.
     */
    test('offers no preview, having no path to offer beside one', async () => {
        expect(await runCommand('echo deepclaw')).not.toHaveProperty('preview');
    });
});

describe('childProcessTimeout', () => {

    test('is expressed in seconds', () => {
        expect(childProcessTimeout).toBe(120);
    });
});
