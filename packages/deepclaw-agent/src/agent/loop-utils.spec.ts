import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type LLMTaskOutput} from '@deepclaw/core';
import {saveToPublic} from './loop-utils';
import {PROJECT_TASK_OUTPUT_DIR, PUBLIC} from './paths';

const mocks = vi.hoisted(() => ({
    exists: vi.fn<(path: string) => boolean>(() => true),
    writeFile: vi.fn<(path: string, content: string | Buffer) => string>((path) => path),
    hashString: vi.fn<(text: string) => string>(() => 'hash1234'),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {exists: mocks.exists, writeFile: mocks.writeFile, hashString: mocks.hashString},
}));

const LONG_TEXT = 'x'.repeat(1501);

function newOutput(overrides: Partial<LLMTaskOutput> = {}): NonNullable<LLMTaskOutput> {
    return {type: 'text', content: 'short output', ...overrides};
}

function writtenContent(): string | Buffer {
    return mocks.writeFile.mock.calls[0]![1];
}

describe('saveToPublic', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.exists.mockReturnValue(true);
        mocks.writeFile.mockImplementation((path) => path);
        mocks.hashString.mockReturnValue('hash1234');
    });

    test('does nothing when the public folder is not served', () => {
        mocks.exists.mockReturnValue(false);
        const output = newOutput({content: LONG_TEXT});
        saveToPublic('t1', output, 'a title', PROJECT_TASK_OUTPUT_DIR);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(output.content).toBe(LONG_TEXT);
    });

    test('keeps a short text output inline', () => {
        const output = newOutput();
        saveToPublic('t1', output, 'a title', PROJECT_TASK_OUTPUT_DIR);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(output).toEqual({type: 'text', content: 'short output'});
    });

    test('moves a long text output into a txt file', () => {
        const output = newOutput({content: LONG_TEXT});
        saveToPublic('t1', output, 'a title', PROJECT_TASK_OUTPUT_DIR);
        expect(mocks.writeFile).toHaveBeenCalledWith(`${PROJECT_TASK_OUTPUT_DIR}/t1/hash1234.txt`, LONG_TEXT);
        expect(output.content).toBe('<Content saved to file>');
    });

    test('names the file after the hash of the title', () => {
        mocks.hashString.mockReturnValue('deadbeef');
        saveToPublic('t1', newOutput({content: LONG_TEXT}), 'my report', PROJECT_TASK_OUTPUT_DIR);
        expect(mocks.hashString).toHaveBeenCalledWith('my report');
        expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('deadbeef.txt'), LONG_TEXT);
    });

    test('publishes a url that is relative to the public folder', () => {
        const output = newOutput({content: LONG_TEXT});
        saveToPublic('t1', output, 'a title', PROJECT_TASK_OUTPUT_DIR);
        expect(output.path).toBe(`/${PROJECT_TASK_OUTPUT_DIR.substring(PUBLIC.length + 1)}/t1/hash1234.txt`);
        expect(output.path?.startsWith('/')).toBe(true);
    });

    test('uses the md extension for markdown', () => {
        saveToPublic('t1', newOutput({type: 'markdown', content: LONG_TEXT}), 'a title', PROJECT_TASK_OUTPUT_DIR);
        expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('.md'), LONG_TEXT);
    });

    test('saves a binary output no matter how short it is', () => {
        const output = newOutput({type: 'binary', content: Buffer.from('hi').toString('base64')});
        saveToPublic('t1', output, 'a title', PROJECT_TASK_OUTPUT_DIR);
        expect(mocks.writeFile).toHaveBeenCalledOnce();
        expect(writtenContent().toString('utf8')).toBe('hi');
        expect(output.content).toBe('<Content saved to file>');
    });

    test('falls back to the out extension for a binary output', () => {
        saveToPublic('t1', newOutput({type: 'binary', content: ''}), 'a title', PROJECT_TASK_OUTPUT_DIR);
        expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('.out'), expect.anything());
    });

    test('prefers the extension the task asked for', () => {
        saveToPublic(
            't1', newOutput({content: LONG_TEXT, ext: 'csv'}), 'a title', PROJECT_TASK_OUTPUT_DIR
        );
        expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('.csv'), LONG_TEXT);
    });

    test('writes into the folder it was given', () => {
        saveToPublic('c9', newOutput({content: LONG_TEXT}), 'a title', `${PUBLIC}/cron`);
        expect(mocks.writeFile).toHaveBeenCalledWith(`${PUBLIC}/cron/c9/hash1234.txt`, LONG_TEXT);
    });
});
