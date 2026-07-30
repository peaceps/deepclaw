import {describe, expect, test} from 'vitest';
import {childProcessTimeout, runCommand, runCommandAsync} from './child-process-utils';

describe('runCommandAsync', () => {

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

    test('behaves like runCommandAsync', async () => {
        expect(await runCommand('echo deepclaw')).toEqual(await runCommandAsync('echo deepclaw'));
    });
});

describe('childProcessTimeout', () => {

    test('is expressed in seconds', () => {
        expect(childProcessTimeout).toBe(120);
    });
});
