import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
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

    test('isPathInWorkspace returns true for deepclaw temp path', () => {
        const tmpPath = path.join(os.tmpdir(), '.deepclaw', 'subloop', 'sid', 'messages.json');
        expect(FileUtils.isPathInWorkspace(tmpPath)).toBe(true);
    });

    test('writeFile sanitizes illegal characters in file name while keeping folders', () => {
        FileUtils.writeFile('tmp/sanitize/na?me*<x>.md', 'sanitized');
        expect(FileUtils.readFile('tmp/sanitize/na_me__x_.md')).toBe('sanitized');
    });

    test('findLatest returns the most recently modified file', () => {
        const dir = 'tmp/latest';
        FileUtils.writeFile(`${dir}/old.txt`, 'old');
        FileUtils.writeFile(`${dir}/new.txt`, 'new');
        const base = path.join(process.cwd(), dir);
        fs.utimesSync(path.join(base, 'old.txt'), new Date(1_000), new Date(1_000));
        fs.utimesSync(path.join(base, 'new.txt'), new Date(2_000), new Date(2_000));
        expect(FileUtils.findLatest(dir)).toBe('new.txt');
    });

    test('findLatest returns empty string when folder is missing', () => {
        expect(FileUtils.findLatest('tmp/no-such-folder')).toBe('');
    });

    test('findLatest with subFile selects the latest folder containing it', () => {
        const root = 'tmp/sessions';
        FileUtils.writeFile(`${root}/s1/messages.json`, '[]');
        FileUtils.writeFile(`${root}/s2/messages.json`, '[]');
        const base = path.join(process.cwd(), root);
        fs.utimesSync(path.join(base, 's1', 'messages.json'), new Date(1_000), new Date(1_000));
        fs.utimesSync(path.join(base, 's2', 'messages.json'), new Date(2_000), new Date(2_000));
        expect(FileUtils.findLatest(root, 'messages.json')).toBe('s2');
    });

    test('enforceFileCountLimit removes the oldest files beyond the limit', () => {
        const dir = 'tmp/limited';
        for (let i = 1; i <= 4; i++) {
            FileUtils.writeFile(`${dir}/f${i}.txt`, `${i}`);
        }
        const base = path.join(process.cwd(), dir);
        for (let i = 1; i <= 4; i++) {
            fs.utimesSync(path.join(base, `f${i}.txt`), new Date(i * 1_000), new Date(i * 1_000));
        }
        FileUtils.enforceFileCountLimit(dir, 2);
        expect(fs.readdirSync(base).sort()).toEqual(['f3.txt', 'f4.txt']);
    });

    test('enforceFileCountLimit keeps all files when under the limit', () => {
        const dir = 'tmp/under-limit';
        FileUtils.writeFile(`${dir}/a.txt`, 'a');
        FileUtils.writeFile(`${dir}/b.txt`, 'b');
        FileUtils.enforceFileCountLimit(dir, 5);
        expect(fs.readdirSync(path.join(process.cwd(), dir)).sort()).toEqual(['a.txt', 'b.txt']);
    });
});