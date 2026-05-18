import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, test} from '@jest/globals';
import { FileUtils } from './file-utils';

describe('FileUtils', () => {
    const originCwd = process.cwd();
    let tempDir: string = '';

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepclaw-utils-'));
        process.chdir(tempDir);
    });

    afterAll(() => {
        process.chdir(originCwd);
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    test('wrapTimestamp appends compact timestamp and keeps extension', () => {
        const wrapped = FileUtils.wrapTimestamp('report.txt');
        expect(wrapped).toMatch(/^report_\d{17}\.txt$/);
    });

    test('writeFile and readFile work with nested relative path', () => {
        const relativePath = 'tmp/nested/note.md';
        const content = 'hello deepclaw';
        FileUtils.writeFile(relativePath, content);
        expect(FileUtils.readFile(relativePath)).toBe(content);
    });

    test('readFile throws when file does not exist', () => {
        expect(() => FileUtils.readFile('missing/file.txt')).toThrow('not found');
    });

    test('writeFileToSession writes file under session dir and returns relative path', () => {
        const relativePath = FileUtils.writeFileToSession('parent', 'session', 'tool_results', 'result.txt', 'ok');
        expect(relativePath.replace(/\\/g, '/')).toBe('.session/parent/session/tool_results/result.txt');
        expect(FileUtils.readFile(relativePath)).toBe('ok');
    });

    test('isPathInWorkspace returns true for local path', () => {
        const localPath = path.join(process.cwd(), 'tmp', 'nested', 'note.md');
        expect(FileUtils.isPathInWorkspace(localPath)).toBe(true);
    });

    test('isPathInWorkspace returns false for path outside workspace', () => {
        const outsidePath = path.resolve(tempDir, '..', 'outside.txt');
        expect(FileUtils.isPathInWorkspace(outsidePath)).toBe(false);
    });

    test('isPathInWorkspace returns false for sibling path with same prefix', () => {
        const siblingPath = `${tempDir}-sibling/file.txt`;
        expect(FileUtils.isPathInWorkspace(siblingPath)).toBe(false);
    });

    test('isPathInWorkspace returns false for traversal path escaping workspace', () => {
        expect(FileUtils.isPathInWorkspace('../outside-by-traversal.txt')).toBe(false);
    });
});
