import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest';
import { FileStore } from './file-store';

const REPORT = Buffer.from('the report of the third quarter');

describe('FileStore', () => {
    let tempDir = '';

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepclaw-files-'));
        // The data root is named by the environment, and a test of it says which one it means.
        vi.stubEnv('DEEPCLAW_HOME', tempDir);
        write('.projects/p1/files/Q3 report.pdf', REPORT);
        write('.projects/p1/files/a&b (v2..final).csv', Buffer.from('a,b'));
        write('.projects/p1/files/charts/q3.csv', Buffer.from('q,3'));
        write('.projects/p1/output/hash1234.md', Buffer.from('# the report'));
        write('.cron/c1/files/digest.csv', Buffer.from('a,b'));
        write('.agents/a1/SOUL.json', Buffer.from('{}'));
    });

    afterAll(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    function write(file: string, bytes: Buffer): void {
        fs.mkdirSync(path.join(tempDir, path.dirname(file)), {recursive: true});
        fs.writeFileSync(path.join(tempDir, file), bytes);
    }

    test('names a url by the path the file was written under', () => {
        expect(FileStore.urlOf('.projects/p1/files/report.pdf'))
            .toBe('/api/file/projects/p1/files/report.pdf');
    });

    /** A space in a link is where the link ends, and a name the user chose is full of them. */
    test('encodes what a url cannot carry', () => {
        expect(FileStore.urlOf('.projects/p1/files/Q3 report (final).pdf'))
            .toBe('/api/file/projects/p1/files/Q3%20report%20(final).pdf');
    });

    test('reads back the file a url names', () => {
        expect(FileStore.read('projects/p1/files/Q3 report.pdf')).toEqual(REPORT);
        expect(FileStore.read('projects/p1/output/hash1234.md')?.toString()).toBe('# the report');
        expect(FileStore.read('cron/c1/files/digest.csv')?.toString()).toBe('a,b');
    });

    /**
     * A run writes into the folder with a shell of its own, so the name on disk is whatever it
     * chose. Reading it under a name cleaned up for writing would look for a file nobody wrote.
     */
    test('reads a file back under the name it really lies under', () => {
        expect(FileStore.read('projects/p1/files/a&b (v2..final).csv')?.toString()).toBe('a,b');
    });

    test('carries a name a url cannot hold there and back', () => {
        const url = FileStore.urlOf('.projects/p1/files/a&b (v2..final).csv');
        expect(FileStore.read(FileStore.keyOf(url)!)?.toString()).toBe('a,b');
    });

    /** Whoever reads the file rather than fetching it needs the path, a link is for a browser. */
    test('names the file a url of ours was made from', () => {
        const path = '.projects/p1/files/Q3 report.pdf';
        expect(FileStore.fileOf(FileStore.urlOf(path))).toBe(path);
    });

    test('names no file for a url that leads out of what it serves', () => {
        expect(FileStore.fileOf('/api/image/abc123.png')).toBeNull();
        expect(FileStore.fileOf('/api/file/agents/a1/SOUL.json')).toBeNull();
        expect(FileStore.fileOf('/api/file/projects/p1/files/../../../etc/passwd')).toBeNull();
    });

    test('takes no key out of a url that is none of ours', () => {
        expect(FileStore.keyOf('/api/image/abc123.png')).toBeNull();
        expect(FileStore.keyOf('https://host/api/file/projects/p1/files/report.pdf')).toBeNull();
        expect(FileStore.keyOf('/api/file/projects/p1/files/100%.pdf')).toBeNull();
    });

    test('answers with nothing for a file that was never handed over', () => {
        expect(FileStore.read('projects/p1/files/gone.pdf')).toBeNull();
    });

    /** Only what a run hands over is served, the rest of the data root is nobody's business. */
    test('refuses everything outside the folders a run hands over from', () => {
        expect(FileStore.read('agents/a1/SOUL.json')).toBeNull();
        expect(FileStore.read('projects/p1/session/messages.jsonl')).toBeNull();
        expect(FileStore.read('projects/p1/files')).toBeNull();
        expect(FileStore.read('projects/p1')).toBeNull();
    });

    test('refuses a key that tries to walk out of the store', () => {
        expect(FileStore.read('projects/p1/files/../../../.agents/a1/SOUL.json')).toBeNull();
        expect(FileStore.read('../../etc/passwd')).toBeNull();
    });

    /**
     * A backslash is what a path is written with on Windows, where such a key walks out of the
     * folders that are served while reading as though it stayed in them.
     */
    test('refuses a key that walks out the way another system writes a path', () => {
        const key = 'projects/p1/files/..\\..\\..\\.agents/a1/SOUL.json';
        // Where such a key comes out is the system it is resolved on, so it is named nowhere here.
        expect(FileStore.fileOf(`/api/file/${key}`)).toBeNull();
        expect(FileStore.tagOf(key)).toBeNull();
        expect(FileStore.read(key)).toBeNull();
    });

    /**
     * Where a key comes out is what says whether it may be served, and that is asked of whoever
     * resolves it rather than of the letters of the key: a step aside inside the store is a step.
     */
    test('refuses a key that names one file and comes out at another', () => {
        expect(FileStore.read('projects/p1/files/charts/../../output/hash1234.md')).toBeNull();
        expect(FileStore.read('projects/p1/files/charts/../Q3 report.pdf')).toBeNull();
    });

    /** The name of a file is reused by the next run, so it is no answer to whether it changed. */
    test('tells the copy of a browser apart from the file as it lies now', () => {
        write('.projects/p1/output/rerun.md', Buffer.from('# a first go'));
        const tag = FileStore.tagOf('projects/p1/output/rerun.md');
        expect(tag).not.toBeNull();
        expect(FileStore.tagOf('projects/p1/output/rerun.md')).toBe(tag);
        write('.projects/p1/output/rerun.md', Buffer.from('# the report, at last'));
        expect(FileStore.tagOf('projects/p1/output/rerun.md')).not.toBe(tag);
    });

    test('has nothing to tell apart for what it does not serve', () => {
        expect(FileStore.tagOf('agents/a1/SOUL.json')).toBeNull();
        expect(FileStore.tagOf('projects/p1/files/gone.pdf')).toBeNull();
        expect(FileStore.tagOf('projects/p1/files')).toBeNull();
    });

    test('tells a browser what to make of the bytes', () => {
        expect(FileStore.mediaTypeOf('report.PDF')).toBe('application/pdf');
        expect(FileStore.mediaTypeOf('digest.csv')).toBe('text/csv; charset=utf-8');
        expect(FileStore.mediaTypeOf('chart.png')).toBe('image/png');
        expect(FileStore.mediaTypeOf('archive.tar')).toBe('application/octet-stream');
        expect(FileStore.mediaTypeOf('README')).toBe('application/octet-stream');
    });
});
