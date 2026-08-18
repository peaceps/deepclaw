import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import { FileStore } from './file-store';

const REPORT = Buffer.from('the report of the third quarter');

describe('FileStore', () => {
    const originCwd = process.cwd();
    let tempDir = '';

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepclaw-files-'));
        process.chdir(tempDir);
        write('.projects/p1/files/Q3 report.pdf', REPORT);
        write('.projects/p1/output/hash1234.md', Buffer.from('# the report'));
        write('.cron/c1/files/digest.csv', Buffer.from('a,b'));
        write('.agents/a1/SOUL.json', Buffer.from('{}'));
    });

    afterAll(() => {
        process.chdir(originCwd);
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

    test('tells a browser what to make of the bytes', () => {
        expect(FileStore.mediaTypeOf('report.PDF')).toBe('application/pdf');
        expect(FileStore.mediaTypeOf('digest.csv')).toBe('text/csv; charset=utf-8');
        expect(FileStore.mediaTypeOf('chart.png')).toBe('image/png');
        expect(FileStore.mediaTypeOf('archive.tar')).toBe('application/octet-stream');
        expect(FileStore.mediaTypeOf('README')).toBe('application/octet-stream');
    });
});
