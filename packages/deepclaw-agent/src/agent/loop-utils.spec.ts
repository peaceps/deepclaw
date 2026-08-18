import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type LLMTaskOutput} from '@deepclaw/core';
import {publishGeneratedFiles, saveToPublic} from './loop-utils';
import {PROJECT_TASK_OUTPUT_DIR, PUBLIC} from './paths';

const mocks = vi.hoisted(() => ({
    exists: vi.fn<(path: string) => boolean>(() => true),
    writeFile: vi.fn<(path: string, content: string | Buffer) => string>((path) => path),
    hashString: vi.fn<(text: string) => string>(() => 'hash1234'),
    readBuffer: vi.fn<(path: string) => Buffer>(path => Buffer.from(`bytes of ${path}`)),
    isPathInWorkspace: vi.fn<(path: string) => boolean>(() => true),
    saveImage: vi.fn<(bytes: Buffer, extension: string, loopId: string) => string>(
        (_bytes, extension, loopId) => `${loopId}/imagehash.${extension}`
    ),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        exists: mocks.exists, writeFile: mocks.writeFile, hashString: mocks.hashString,
        readBuffer: mocks.readBuffer, isPathInWorkspace: mocks.isPathInWorkspace,
    },
    ImageStore: {save: mocks.saveImage},
}));

vi.mock('@deepclaw/i18n', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/i18n')>()),
    i18nInstance: {t: (key: string) => key},
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

describe('publishGeneratedFiles', () => {

    const HEADLINE = 'agent.tools.project.output.generatedFiles';

    function publish(output: NonNullable<LLMTaskOutput>, files: string[]) {
        return publishGeneratedFiles('t1', output, 'a title', files, PROJECT_TASK_OUTPUT_DIR);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.exists.mockReturnValue(true);
        mocks.writeFile.mockImplementation((path) => path);
        mocks.hashString.mockReturnValue('hash1234');
        mocks.readBuffer.mockImplementation(path => Buffer.from(`bytes of ${path}`));
        mocks.isPathInWorkspace.mockReturnValue(true);
        mocks.saveImage.mockImplementation(
            (_bytes, extension, loopId) => `${loopId}/imagehash.${extension}`
        );
    });

    test('copies the file into a folder of that task', () => {
        publish(newOutput({type: 'markdown'}), ['out/report.pdf']);
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${PROJECT_TASK_OUTPUT_DIR}/t1/hash1234/report.pdf`, Buffer.from('bytes of out/report.pdf')
        );
    });

    test('links the copy under the public folder', () => {
        const output = newOutput({type: 'markdown', content: 'the report'});
        publish(output, ['out/report.pdf']);
        expect(output.content).toBe(`the report

## ${HEADLINE}
- [report.pdf](/projects/t1/hash1234/report.pdf)`);
    });

    test('links every file it was given', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, ['a/one.csv', 'b/two.zip']);
        expect(output.content).toContain('- [one.csv](/projects/t1/hash1234/one.csv)');
        expect(output.content).toContain('- [two.zip](/projects/t1/hash1234/two.zip)');
    });

    test('shows a picture in the output instead of linking it', () => {
        const output = newOutput({type: 'markdown', content: 'the report'});
        expect(publish(output, ['out/chart.png']).published).toEqual(['out/chart.png']);
        expect(mocks.saveImage).toHaveBeenCalledExactlyOnceWith(
            Buffer.from('bytes of out/chart.png'), 'png', 't1'
        );
        expect(output.content).toBe(`the report

## ${HEADLINE}
- ![chart.png](dcimg://t1/imagehash.png)`);
    });

    test('keeps a picture out of the public folder, the store holds it', () => {
        publish(newOutput({type: 'markdown'}), ['out/chart.png']);
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('links a picture beside a report that has no markdown to show it in', () => {
        const output = newOutput({content: 'the report'});
        publish(output, ['out/chart.png']);
        expect(mocks.saveImage).not.toHaveBeenCalled();
        expect(output.content).toContain('- chart.png: /projects/t1/hash1234/chart.png');
    });

    test('tells a picture apart by its name, whatever else was handed over', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, ['a/shot.jpeg', 'b/sheet.csv']);
        expect(output.content).toContain('- ![shot.jpeg](dcimg://t1/imagehash.jpg)');
        expect(output.content).toContain('- [sheet.csv](/projects/t1/hash1234/sheet.csv)');
    });

    test('names the file plainly for a text output, where a link would not be one', () => {
        const output = newOutput({content: 'the report'});
        publish(output, ['out/report.pdf']);
        expect(output.content).toBe(`the report

${HEADLINE}:
- report.pdf: /projects/t1/hash1234/report.pdf`);
    });

    test('leaves a binary output alone, its content is bytes', () => {
        const output = newOutput({type: 'binary', content: 'QUJD'});
        expect(publish(output, ['out/report.pdf'])).toEqual({
            published: [], skipped: ['out/report.pdf']
        });
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(output.content).toBe('QUJD');
    });

    test('hands nothing over when the public folder is not served', () => {
        mocks.exists.mockReturnValue(false);
        const output = newOutput({type: 'markdown', content: 'the report'});
        expect(publish(output, ['out/report.pdf']).skipped).toEqual(['out/report.pdf']);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(output.content).toBe('the report');
    });

    test('skips a file that lies outside the workspace', () => {
        mocks.isPathInWorkspace.mockImplementation(path => path !== '../../.ssh/id_rsa');
        const output = newOutput({type: 'markdown'});
        const {published, skipped} = publish(output, ['../../.ssh/id_rsa', 'out/report.pdf']);
        expect(published).toEqual(['out/report.pdf']);
        expect(skipped).toEqual(['../../.ssh/id_rsa']);
        expect(mocks.readBuffer).not.toHaveBeenCalledWith('../../.ssh/id_rsa');
    });

    test('skips what cannot be read, a folder as much as a file that is not there', () => {
        mocks.readBuffer.mockImplementation(path => {
            if (path === 'out') throw new Error('EISDIR');
            return Buffer.from('bytes');
        });
        const output = newOutput({type: 'markdown'});
        const {published, skipped} = publish(output, ['out', 'out/report.pdf']);
        expect(published).toEqual(['out/report.pdf']);
        expect(skipped).toEqual(['out']);
        expect(output.content).toContain('- [report.pdf]');
    });

    test('keeps two files of the same name apart', () => {
        mocks.hashString.mockImplementation((text: string) => `hash-${text}`);
        const output = newOutput({type: 'markdown'});
        publish(output, ['src/README.md', 'docs/README.md']);
        expect(output.content).toContain('- [README.md](/projects/t1/hash-a title/README.md)');
        expect(output.content).toContain(
            '- [hash-docs/README.md-README.md](/projects/t1/hash-a title/hash-docs/README.md-README.md)'
        );
    });

    test('copies a file named twice only once', () => {
        publish(newOutput({type: 'markdown'}), ['out/report.pdf', 'out/report.pdf']);
        expect(mocks.writeFile).toHaveBeenCalledOnce();
    });

    test('says nothing in the content when nothing could be handed over', () => {
        mocks.isPathInWorkspace.mockReturnValue(false);
        const output = newOutput({type: 'markdown', content: 'the report'});
        publish(output, ['/etc/passwd']);
        expect(output.content).toBe('the report');
    });
});
