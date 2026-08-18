import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type LLMTaskOutput} from '@deepclaw/core';
import {
    fileAwayOutput, keptOutput, MAX_GENERATED_FILES, publishGeneratedFiles, requireReadableOutput
} from './loop-utils';
import {cronOutputDir, projectFilesDir, projectOutputDir} from './paths';

const mocks = vi.hoisted(() => ({
    writeFile: vi.fn<(path: string, content: string | Buffer) => string>((path) => path),
    hashString: vi.fn<(text: string) => string>(() => 'hash1234'),
    readBuffer: vi.fn<(path: string) => Buffer>(path => Buffer.from(`bytes of ${path}`)),
    sizeOf: vi.fn<(path: string) => number | null>(),
    isPathInWorkspace: vi.fn<(path: string) => boolean>(() => true),
    isFile: vi.fn<(path: string) => boolean>(() => true),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('@deepclaw/node-utils')>();
    const real = original.FileUtils;
    return {
        ...original,
        FileUtils: {
            writeFile: mocks.writeFile, hashString: mocks.hashString,
            readBuffer: mocks.readBuffer, sizeOf: mocks.sizeOf,
            isPathInWorkspace: mocks.isPathInWorkspace, isFile: mocks.isFile,
            // Reading a path is pure, and where a path comes down to is what the test is about.
            sanitizeFileName: real.sanitizeFileName.bind(real),
            getAbsolutePath: real.getAbsolutePath.bind(real),
            isPathInside: real.isPathInside.bind(real),
        },
    };
});

vi.mock('@deepclaw/i18n', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/i18n')>()),
    i18nInstance: {t: (key: string) => key},
}));

const LONG_TEXT = 'x'.repeat(1501);
const FILES = projectFilesDir('pr1');
const URL_OF_FILES = '/api/file/projects/pr1/files';

function newOutput(overrides: Partial<LLMTaskOutput> = {}): NonNullable<LLMTaskOutput> {
    return {type: 'text', content: 'short output', ...overrides};
}

describe('fileAwayOutput', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.writeFile.mockImplementation((path) => path);
    });

    test('keeps a short text output inline', () => {
        const output = newOutput();
        fileAwayOutput(output, projectOutputDir('pr1'), 'hash1234');
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(output).toEqual({type: 'text', content: 'short output'});
    });

    test('moves a long text output into a txt file of the project', () => {
        const output = newOutput({content: LONG_TEXT});
        fileAwayOutput(output, projectOutputDir('pr1'), 'hash1234');
        expect(mocks.writeFile).toHaveBeenCalledWith('.projects/pr1/output/hash1234.txt', LONG_TEXT);
        expect(output.content).toBe('<Content saved to file>');
    });

    test('publishes a url the browser can follow', () => {
        const output = newOutput({content: LONG_TEXT});
        fileAwayOutput(output, projectOutputDir('pr1'), 'hash1234');
        expect(output.path).toBe('/api/file/projects/pr1/output/hash1234.txt');
    });

    test('uses the md extension for markdown', () => {
        fileAwayOutput(newOutput({type: 'markdown', content: LONG_TEXT}), projectOutputDir('pr1'), 'n');
        expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('.md'), LONG_TEXT);
    });

    test('prefers the extension the task asked for', () => {
        fileAwayOutput(newOutput({content: LONG_TEXT, ext: 'csv'}), projectOutputDir('pr1'), 'n');
        expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('.csv'), LONG_TEXT);
    });

    test('writes into the folder it was given, under the name it was given', () => {
        fileAwayOutput(newOutput({content: LONG_TEXT}), cronOutputDir('c9'), '1755000000000');
        expect(mocks.writeFile).toHaveBeenCalledWith('.cron/c9/output/1755000000000.txt', LONG_TEXT);
    });

    /**
     * Filing away rests on the placeholder being shorter than what is worth filing: a second pass
     * over a filed output would otherwise write that placeholder over the report it stands for.
     */
    test('leaves an output that was filed away already alone', () => {
        const output = newOutput({content: LONG_TEXT});
        fileAwayOutput(output, projectOutputDir('pr1'), 'hash1234');
        const filed = {...output};
        fileAwayOutput(output, projectOutputDir('pr1'), 'hash1234');
        expect(mocks.writeFile).toHaveBeenCalledOnce();
        expect(output).toEqual(filed);
    });
});

describe('requireReadableOutput', () => {

    test('turns away an output that carries the bytes of a file', () => {
        expect(() => requireReadableOutput(newOutput({type: 'binary', content: 'QUJD'})))
            .toThrow('not the bytes of a file');
    });

    test('lets what the user can read through', () => {
        expect(() => requireReadableOutput(newOutput({type: 'markdown'}))).not.toThrow();
        expect(() => requireReadableOutput(newOutput())).not.toThrow();
    });
});

describe('keptOutput', () => {

    const KEPT = '<Output kept>';

    test('leaves the words of an inlined output out and says where they went', () => {
        expect(keptOutput(newOutput({content: 'the whole report'}), KEPT))
            .toEqual({type: 'text', content: KEPT});
    });

    test('keeps what the output is and where it lies', () => {
        expect(keptOutput(newOutput({type: 'markdown', content: '# the report', ext: 'csv'}), KEPT))
            .toEqual({type: 'markdown', content: KEPT, ext: 'csv'});
    });

    /** A path is only ever set by filing away, and what it was set on holds no words any more. */
    test('leaves an output that was filed away as it lies', () => {
        const filed = newOutput({content: '<Content saved to file>', path: '/api/file/x.txt'});
        expect(keptOutput(filed, KEPT)).toBe(filed);
    });

    test('leaves the output it was given untouched', () => {
        const output = newOutput({content: 'the whole report'});
        keptOutput(output, KEPT);
        expect(output.content).toBe('the whole report');
    });
});

describe('publishGeneratedFiles', () => {

    const HEADLINE = 'agent.tools.project.output.generatedFiles';

    function publish(output: NonNullable<LLMTaskOutput>, files: string[]) {
        return publishGeneratedFiles(output, files, FILES);
    }

    /** Nothing has been filed under the project yet, so only what a run points at can be read. */
    function filed(path: string): Buffer {
        if (path.startsWith(`${FILES}/`)) {
            throw new Error('ENOENT');
        }
        return Buffer.from(`bytes of ${path}`);
    }

    /** A file on disk has the size of the bytes it was given, whatever a test made those. */
    function sizeOnDisk(path: string): number | null {
        try {
            return mocks.readBuffer.getMockImplementation()!(path).length;
        } catch {
            return null;
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.writeFile.mockImplementation((path) => path);
        mocks.hashString.mockReturnValue('hash1234');
        mocks.readBuffer.mockImplementation(filed);
        mocks.sizeOf.mockImplementation(sizeOnDisk);
        mocks.isPathInWorkspace.mockReturnValue(true);
        mocks.isFile.mockReturnValue(true);
    });

    test('copies a file from elsewhere into the folder the project hands over from', () => {
        publish(newOutput({type: 'markdown'}), ['out/report.pdf']);
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${FILES}/report.pdf`, Buffer.from('bytes of out/report.pdf')
        );
    });

    test('links the copy through the route that serves it', () => {
        const output = newOutput({type: 'markdown', content: 'the report'});
        publish(output, ['out/report.pdf']);
        expect(output.content).toBe(`the report

## ${HEADLINE}
- [report.pdf](${URL_OF_FILES}/report.pdf)`);
    });

    test('links every file it was given', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, ['a/one.csv', 'b/two.zip']);
        expect(output.content).toContain(`- [one.csv](${URL_OF_FILES}/one.csv)`);
        expect(output.content).toContain(`- [two.zip](${URL_OF_FILES}/two.zip)`);
    });

    /** The folder it goes to is the folder it was written in, and a copy of it is a second file. */
    test('hands a file already lying in that folder over where it lies', () => {
        const output = newOutput({type: 'markdown'});
        const {published} = publish(output, [`${FILES}/digest.csv`]);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(published).toEqual([`${FILES}/digest.csv`]);
        expect(output.content).toContain(`- [digest.csv](${URL_OF_FILES}/digest.csv)`);
    });

    test('keeps the subfolder of a file that lies deeper in that folder', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, [`${FILES}/charts/q3.csv`]);
        expect(output.content).toContain(`- [q3.csv](${URL_OF_FILES}/charts/q3.csv)`);
    });

    test('takes an absolute path into that folder as one that lies there', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, [`${process.cwd()}/${FILES}/digest.csv`]);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(output.content).toContain(`- [digest.csv](${URL_OF_FILES}/digest.csv)`);
    });

    test('skips a folder that lies where the files do, there is nothing to hand over', () => {
        mocks.isFile.mockReturnValue(false);
        const output = newOutput({type: 'markdown', content: 'the report'});
        expect(publish(output, [`${FILES}/charts`]).skipped).toEqual([`${FILES}/charts`]);
        expect(output.content).toBe('the report');
    });

    test('shows a picture in the output instead of linking it', () => {
        const output = newOutput({type: 'markdown', content: 'the report'});
        expect(publish(output, ['out/chart.png']).published).toEqual(['out/chart.png']);
        expect(output.content).toBe(`the report

## ${HEADLINE}
- ![chart.png](${URL_OF_FILES}/chart.png)`);
    });

    /** A picture is a file of the run like any other, and one folder holds what a run produced. */
    test('files a picture where the other files of the run go', () => {
        publish(newOutput({type: 'markdown'}), ['out/chart.png']);
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${FILES}/chart.png`, Buffer.from('bytes of out/chart.png')
        );
    });

    test('shows a picture that already lies in that folder without copying it', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, [`${FILES}/chart.png`]);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(output.content).toContain(`- ![chart.png](${URL_OF_FILES}/chart.png)`);
    });

    test('names a picture beside a report that has no markdown to show it in', () => {
        const output = newOutput({content: 'the report'});
        publish(output, ['out/chart.png']);
        expect(output.content).toContain(`- chart.png: ${URL_OF_FILES}/chart.png`);
    });

    test('tells a picture apart by its name, whatever else was handed over', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, ['a/shot.jpeg', 'b/sheet.csv']);
        expect(output.content).toContain(`- ![shot.jpeg](${URL_OF_FILES}/shot.jpeg)`);
        expect(output.content).toContain(`- [sheet.csv](${URL_OF_FILES}/sheet.csv)`);
    });

    test('names the file plainly for a text output, where a link would not be one', () => {
        const output = newOutput({content: 'the report'});
        publish(output, ['out/report.pdf']);
        expect(output.content).toBe(`the report

${HEADLINE}:
- report.pdf: ${URL_OF_FILES}/report.pdf`);
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
        expect(output.content).toContain(`- [README.md](${URL_OF_FILES}/README.md)`);
        expect(output.content).toContain(
            `- [hash-docs/README.md-README.md](${URL_OF_FILES}/hash-docs/README.md-README.md)`
        );
    });

    /** A run that files into the folder again must not bury what the run before it left there. */
    test('keeps a name that is taken on disk by another file', () => {
        mocks.readBuffer.mockImplementation(path => Buffer.from(`bytes of ${path}`));
        const output = newOutput({type: 'markdown'});
        publish(output, ['out/report.pdf']);
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${FILES}/hash1234-report.pdf`, Buffer.from('bytes of out/report.pdf')
        );
    });

    /** Two files of one size are two files still: the size only settles the cheap half of it. */
    test('keeps a name taken on disk by a file of the same size', () => {
        const bytes = 'bytes of out/report.pdf';
        mocks.readBuffer.mockImplementation(path => Buffer.from(
            path === `${FILES}/report.pdf` ? 'A'.repeat(bytes.length) : bytes
        ));
        publish(newOutput({type: 'markdown'}), ['out/report.pdf']);
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${FILES}/hash1234-report.pdf`, Buffer.from(bytes)
        );
    });

    test('writes the same file handed over twice back under its own name', () => {
        mocks.readBuffer.mockImplementation(path => Buffer.from(
            `bytes of ${path === `${FILES}/report.pdf` ? 'out/report.pdf' : path}`
        ));
        publish(newOutput({type: 'markdown'}), ['out/report.pdf']);
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${FILES}/report.pdf`, Buffer.from('bytes of out/report.pdf')
        );
    });

    /** A link target has no room for a space, and the file the user asked for often carries one. */
    test('encodes what a url cannot carry and leaves the name it is shown under alone', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, ['out/Q3 report (final).pdf']);
        expect(output.content).toContain(
            `- [Q3 report (final).pdf](${URL_OF_FILES}/Q3%20report%20(final).pdf)`
        );
    });

    /** A run writes into that folder itself, so the name is whatever it chose, brackets and all. */
    test('keeps a bracket of a name from ending the link it is shown in', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, [`${FILES}/report [final].pdf`]);
        expect(output.content).toContain(
            `- [report \\[final\\].pdf](${URL_OF_FILES}/report%20%5Bfinal%5D.pdf)`
        );
    });

    test('encodes a hash in a name that a browser would read as an anchor', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, ['out/notes#2.md']);
        expect(output.content).toContain(`(${URL_OF_FILES}/notes%232.md)`);
    });

    test('names the path of a text output the same way', () => {
        const output = newOutput();
        publish(output, ['out/Q3 report.pdf']);
        expect(output.content).toContain(`- Q3 report.pdf: ${URL_OF_FILES}/Q3%20report.pdf`);
    });

    /** Both names come down to one file on disk, and the later one must not bury the earlier. */
    test('keeps two names apart that a path cannot tell apart', () => {
        const output = newOutput({type: 'markdown'});
        publish(output, ['a/x?y.pdf', 'b/x*y.pdf']);
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${FILES}/x_y.pdf`, Buffer.from('bytes of a/x?y.pdf')
        );
        expect(output.content).toContain(`- [x_y.pdf](${URL_OF_FILES}/x_y.pdf)`);
        expect(output.content).toContain(`- [hash1234-x_y.pdf](${URL_OF_FILES}/hash1234-x_y.pdf)`);
    });

    test('hands over no more files than one output may carry', () => {
        const files = Array.from({length: 12}, (_unused, index) => `out/file${index}.csv`);
        const {published, skipped} = publish(newOutput({type: 'markdown'}), files);
        expect(published).toEqual(files.slice(0, MAX_GENERATED_FILES));
        expect(skipped).toEqual(files.slice(MAX_GENERATED_FILES));
        expect(mocks.writeFile).toHaveBeenCalledTimes(MAX_GENERATED_FILES);
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
