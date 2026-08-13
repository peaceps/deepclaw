import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import {afterAll, afterEach, beforeAll, describe, expect, test, vi} from 'vitest';
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

    describe('copyResource', () => {

        function moduleDirWith(name: string, resources: string, content: string): string {
            const moduleDir = path.join(tempDir, 'module', name);
            const resourceDir = path.join(moduleDir, resources);
            fs.mkdirSync(resourceDir, {recursive: true});
            fs.writeFileSync(path.join(resourceDir, 'DEEPCLAW.md'), content);
            return moduleDir;
        }

        afterEach(() => {
            vi.unstubAllEnvs();
        });

        test('takes the resource that sits beside the module that asks for it', () => {
            const moduleDir = moduleDirWith('beside', 'resources', 'beside');
            FileUtils.copyResource(moduleDir, 'DEEPCLAW.md', 'tmp/beside');
            expect(FileUtils.readFile('tmp/beside/DEEPCLAW.md')).toBe('beside');
        });

        /** A bundle sits one folder deeper than the resources that were shipped with it. */
        test('looks one folder up when the module has none of its own', () => {
            const bundleDir = path.join(moduleDirWith('above', 'resources', 'above'), 'dist');
            FileUtils.copyResource(bundleDir, 'DEEPCLAW.md', 'tmp/above');
            expect(FileUtils.readFile('tmp/above/DEEPCLAW.md')).toBe('above');
        });

        /** Code of a packaged build is bundled away from its resources, so the launcher names them. */
        test('prefers the folder the launcher named over the one beside the module', () => {
            const moduleDir = moduleDirWith('named', 'resources', 'beside');
            const shipped = path.join(tempDir, 'shipped');
            fs.mkdirSync(shipped, {recursive: true});
            fs.writeFileSync(path.join(shipped, 'DEEPCLAW.md'), 'shipped');
            vi.stubEnv('DEEPCLAW_RESOURCES', shipped);

            FileUtils.copyResource(moduleDir, 'DEEPCLAW.md', 'tmp/named');

            expect(FileUtils.readFile('tmp/named/DEEPCLAW.md')).toBe('shipped');
        });

        test('leaves the destination alone when the resource is nowhere to be found', () => {
            FileUtils.copyResource(path.join(tempDir, 'nothing'), 'DEEPCLAW.md', 'tmp/nothing');
            expect(FileUtils.exists('tmp/nothing/DEEPCLAW.md')).toBe(false);
        });

        test('keeps a resource the user already has', () => {
            const moduleDir = moduleDirWith('kept', 'resources', 'shipped');
            FileUtils.writeFile('tmp/kept/DEEPCLAW.md', 'mine');

            FileUtils.copyResource(moduleDir, 'DEEPCLAW.md', 'tmp/kept');

            expect(FileUtils.readFile('tmp/kept/DEEPCLAW.md')).toBe('mine');
        });
    });
});