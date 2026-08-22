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

    /**
     * A name is read with the separators of every system, since that is how it is written to disk.
     * Asking of the name as it stands and writing it as something else would let a path that was
     * allowed lead somewhere nobody allowed.
     */
    test('isPathInWorkspace returns false for traversal written with backslashes', () => {
        expect(FileUtils.isPathInWorkspace('..\\..\\outside-by-traversal.txt')).toBe(false);
        expect(FileUtils.isPathInside(tempDir, 'nested\\..\\..\\outside.txt')).toBe(false);
    });

    test('getAbsolutePath answers with the path a name is written to disk under', () => {
        expect(FileUtils.getAbsolutePath('tmp\\nested\\..\\note.md'))
            .toBe(FileUtils.getAbsolutePath('tmp/note.md'));
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

    describe('isLink', () => {

        test('tells a link from the folder it leads to', () => {
            const base = path.join(process.cwd(), 'tmp', 'islink');
            fs.mkdirSync(path.join(base, 'real'), {recursive: true});
            fs.symlinkSync(path.join(base, 'real'), path.join(base, 'linked'), 'junction');
            expect(FileUtils.isLink('tmp/islink/linked')).toBe(true);
            expect(FileUtils.isLink('tmp/islink/real')).toBe(false);
        });

        /** What it leads to is not the question, or a leftover link could never be answered for. */
        test('calls a link leading nowhere a link', () => {
            const base = path.join(process.cwd(), 'tmp', 'islink-gone');
            fs.mkdirSync(base, {recursive: true});
            fs.symlinkSync(path.join(base, 'never-existed'), path.join(base, 'linked'), 'junction');
            expect(FileUtils.isLink('tmp/islink-gone/linked')).toBe(true);
        });

        test('calls what is not there no link', () => {
            expect(FileUtils.isLink('tmp/islink-nothing')).toBe(false);
        });
    });

    describe('deleteDir', () => {

        test('takes the folder and everything under it', () => {
            FileUtils.writeFile('tmp/gone/deep/note.md', 'note');
            FileUtils.deleteDir('tmp/gone');
            expect(FileUtils.exists('tmp/gone')).toBe(false);
        });

        test('says nothing of a folder that was never there', () => {
            expect(() => FileUtils.deleteDir('tmp/never-was')).not.toThrow();
        });

        /**
         * An installer links a folder of its own into another, and what is asked of that link is
         * what it leads to. A link left over its target answers nothing, and is there all the same.
         */
        test('takes a link that leads nowhere', () => {
            const dir = path.join(process.cwd(), 'tmp', 'links');
            fs.mkdirSync(dir, {recursive: true});
            const link = path.join(dir, 'dangling');
            fs.symlinkSync(path.join(dir, 'never-existed'), link, 'junction');
            expect(FileUtils.exists('tmp/links/dangling')).toBe(false);

            FileUtils.deleteDir('tmp/links/dangling');

            expect(fs.readdirSync(dir)).toEqual([]);
        });

        /** The link is the leftover, not what it points at: a shared folder outlives its links. */
        test('takes the link without following it', () => {
            const base = path.join(process.cwd(), 'tmp', 'shared');
            fs.mkdirSync(base, {recursive: true});
            const target = path.join(base, 'skill');
            fs.mkdirSync(target);
            fs.writeFileSync(path.join(target, 'SKILL.md'), 'kept');
            fs.symlinkSync(target, path.join(base, 'link'), 'junction');

            FileUtils.deleteDir('tmp/shared/link');

            expect(fs.existsSync(path.join(base, 'link'))).toBe(false);
            expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('kept');
        });
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