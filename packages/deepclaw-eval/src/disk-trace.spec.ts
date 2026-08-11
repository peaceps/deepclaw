import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readDiskTrace } from './disk-trace';
import { newSandbox, removeSandbox } from './sandbox';

let home = '';
const SESSION_DIR = '.agents/eval-agent/session';

beforeEach(() => home = newSandbox());
afterEach(() => removeSandbox(home));

function write(relativePath: string, content: string): void {
    const path = join(home, relativePath);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content, 'utf8');
}

describe('reading back what the run left on disk', () => {

    test('takes status, final text and usage from the session file', () => {
        write(`${SESSION_DIR}/session.json`, JSON.stringify({
            runtime: {
                status: 'idle',
                finalText: 'done',
                transitionReason: 'endLoop',
                usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
            },
        }));

        const trace = readDiskTrace(home, SESSION_DIR);

        expect(trace.status).toBe('idle');
        expect(trace.finalText).toBe('done');
        expect(trace.transitionReason).toBe('endLoop');
        expect(trace.usage!.outputTokens).toBe(3);
    });

    test('reads the history one json line at a time', () => {
        write(`${SESSION_DIR}/messages.jsonl`, '{"role":"user"}\n{"role":"assistant"}\n');

        expect(readDiskTrace(home, SESSION_DIR).messages)
            .toEqual([{role: 'user'}, {role: 'assistant'}]);
    });

    test('keeps a broken history line instead of throwing the run away', () => {
        write(`${SESSION_DIR}/messages.jsonl`, '{"role":"user"}\nnot json\n');

        expect(readDiskTrace(home, SESSION_DIR).messages[1]).toEqual({unparsable: 'not json'});
    });

    test('picks up the project as the run left it', () => {
        write('.projects/p1/project.json', JSON.stringify({id: 'p1', name: 'Ship it'}));

        expect(readDiskTrace(home, SESSION_DIR, 'p1').project).toMatchObject({name: 'Ship it'});
    });

    test('reports an unknown status when nothing was written at all', () => {
        const trace = readDiskTrace(home, SESSION_DIR, 'p1');

        expect(trace.status).toBe('unknown');
        expect(trace.turns).toBe(0);
        expect(trace.messages).toEqual([]);
        expect(trace.project).toBeUndefined();
    });
});
