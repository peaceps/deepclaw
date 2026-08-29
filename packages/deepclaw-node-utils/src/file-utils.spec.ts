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

    test('listFiles names the files of a folder and leaves the folders out', () => {
        FileUtils.writeFile('tmp/listed/one.jsonl', 'a\n');
        FileUtils.writeFile('tmp/listed/two.jsonl', 'b\n');
        FileUtils.writeFile('tmp/listed/under/three.jsonl', 'c\n');
        expect(FileUtils.listFiles('tmp/listed').sort()).toEqual(['one.jsonl', 'two.jsonl']);
        expect(FileUtils.listFiles('tmp/listed/nowhere')).toEqual([]);
    });

    describe('readTailLines', () => {

        function record(name: string, lines: string[], trailingBreak = true): string {
            const file = `tmp/tail/${name}.jsonl`;
            FileUtils.writeFile(file, lines.join('\n') + (trailingBreak ? '\n' : ''));
            return file;
        }

        test('returns the last lines in the order they were written', () => {
            const file = record('short', ['one', 'two', 'three', 'four']);
            expect(FileUtils.readTailLines(file, 2)).toEqual(['three', 'four']);
        });

        test('returns every line when fewer were written than asked for', () => {
            const file = record('fewer', ['one', 'two']);
            expect(FileUtils.readTailLines(file, 10)).toEqual(['one', 'two']);
        });

        test('reads a file whose last line has no break after it', () => {
            const file = record('unterminated', ['one', 'two', 'three'], false);
            expect(FileUtils.readTailLines(file, 2)).toEqual(['two', 'three']);
        });

        test('does not answer with half of a line', () => {
            // Lines big enough that the three wanted do not fit in one read, so the last block ends
            // partway through a line: the break in front of it is the only thing that says the line
            // is whole rather than the tail of a longer one.
            const lines = Array.from({length: 6}, (_, index) => `${index}:${'x'.repeat(30000)}`);
            const file = record('blocks', lines);
            expect(FileUtils.readTailLines(file, 3)).toEqual(lines.slice(-3));
        });

        test('reads a character that straddles the seam between two blocks', () => {
            // Three of these span more than one read, and the seam lands mid character: each half of
            // one decodes to nothing on its own, so the blocks have to be joined before decoding.
            const lines = Array.from({length: 6}, (_, index) => `${index}:${'汉'.repeat(10000)}`);
            const file = record('utf8', lines);
            expect(FileUtils.readTailLines(file, 3)).toEqual(lines.slice(-3));
        });

        test('drops the blank lines a record picked up', () => {
            const file = record('blank', ['one', '', 'two', '', '', 'three']);
            expect(FileUtils.readTailLines(file, 2)).toEqual(['two', 'three']);
        });

        test('stops at what a read may take, a count of lines bounding nothing on its own', () => {
            // Forty lines of a megabyte is forty megabytes, and the count that is a megabyte in one
            // record is hundreds of them in a record whose runs each wrote a page of prose.
            const lines = Array.from({length: 40}, (_, index) => `${index}:${'x'.repeat(1024 * 1024)}`);
            const tail = FileUtils.readTailLines(record('budget', lines), 40);
            expect(tail.length).toBeGreaterThan(0);
            expect(tail.length).toBeLessThan(40);
            // Fewer lines than were asked for, and every one of them whole and in its place.
            expect(tail).toEqual(lines.slice(-tail.length));
        });

        test('answers nothing for a file that is not there, or for no lines at all', () => {
            expect(FileUtils.readTailLines('tmp/tail/ghost.jsonl', 5)).toEqual([]);
            expect(FileUtils.readTailLines(record('none', ['one']), 0)).toEqual([]);
            expect(FileUtils.readTailLines(record('empty', []), 5)).toEqual([]);
        });
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

    /**
     * A write that ends halfway is what killing a process mid-write used to leave behind: a
     * project or a config truncated in the middle of its json, and nothing able to read it since.
     */
    describe('writeFile leaves a whole file or none of it', () => {

        test('leaves nothing of its own behind in the folder it wrote to', () => {
            FileUtils.writeFile('tmp/whole/note.md', 'first');
            FileUtils.writeFile('tmp/whole/note.md', 'second');
            expect(onDisk('tmp/whole')).toEqual(['note.md']);
            expect(FileUtils.readFile('tmp/whole/note.md')).toBe('second');
        });

        test('leaves the file as it was when the new one cannot be written', () => {
            FileUtils.writeFile('tmp/full/note.md', 'as it was');
            vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
                throw new Error('ENOSPC: no space left on device');
            });
            expect(() => FileUtils.writeFile('tmp/full/note.md', 'never lands')).toThrow('ENOSPC');
            vi.restoreAllMocks();
            expect(FileUtils.readFile('tmp/full/note.md')).toBe('as it was');
            expect(onDisk('tmp/full')).toEqual(['note.md']);
        });

        /** Windows turns a rename away while anything else has the file open for a moment. */
        test('writes the file anyway when the rename is refused', () => {
            FileUtils.writeFile('tmp/refused/note.md', 'as it was');
            vi.spyOn(fs, 'renameSync').mockImplementation(() => {
                throw new Error('EPERM: operation not permitted');
            });
            FileUtils.writeFile('tmp/refused/note.md', 'written all the same');
            vi.restoreAllMocks();
            expect(FileUtils.readFile('tmp/refused/note.md')).toBe('written all the same');
            expect(onDisk('tmp/refused')).toEqual(['note.md']);
        });

        /** Two deepclaws over one home write at once, and neither may land in the other's file. */
        test('writes through a file of its own, named for the process writing it', () => {
            const renamed: string[] = [];
            const renameSync = fs.renameSync;
            vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
                renamed.push(String(from));
                renameSync(from, to);
            });

            FileUtils.writeFile('tmp/apiece/note.md', 'first');

            vi.restoreAllMocks();
            expect(renamed[0]).toContain(`note.md.${process.pid}.tmp`);
        });

        /** Clearing away what an older run left is not what a write is for, nor what it pays for. */
        test('does not read the folder it is writing into', () => {
            FileUtils.writeFile('tmp/unwalked/note.md', 'first');
            const readdirSync = vi.spyOn(fs, 'readdirSync');

            FileUtils.writeFile('tmp/unwalked/note.md', 'second');

            vi.restoreAllMocks();
            expect(readdirSync).not.toHaveBeenCalled();
        });

        /**
         * The config holds the user's keys, and a file made fresh is open to whoever the umask
         * allows. What is asked is that the reach is the one the file had, whatever that was:
         * windows keeps no such thing beyond a read-only bit, and answers the same either way.
         */
        test('keeps the reach of the file it replaces', () => {
            FileUtils.writeFile('tmp/reach/config.json', '{}');
            const file = FileUtils.getAbsolutePath('tmp/reach/config.json');
            fs.chmodSync(file, 0o600);
            const reach = fs.statSync(file).mode;

            FileUtils.writeFile('tmp/reach/config.json', '{"key": "second"}');

            expect(fs.statSync(file).mode).toBe(reach);
        });

        /**
         * Writing to a link has never meant putting a file of that name in the link's place.
         * Making a link to a file is a privilege on windows that a test cannot ask for, which is
         * why the links elsewhere in this file are junctions and lead to folders.
         */
        test.skipIf(process.platform === 'win32')('writes where a link leads rather than over the link', () => {
            FileUtils.writeFile('tmp/linked/real/note.md', 'first');
            const real = FileUtils.getAbsolutePath('tmp/linked/real/note.md');
            const link = FileUtils.getAbsolutePath('tmp/linked/note.md');
            fs.symlinkSync(real, link);

            FileUtils.writeFile('tmp/linked/note.md', 'second');

            expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
            expect(fs.readFileSync(real, 'utf8')).toBe('second');
        });

        /** A skill is installed as a linked folder, and what is written into one lands there. */
        test('writes into the folder a link leads to, and leaves nothing at the link', () => {
            FileUtils.writeFile('tmp/junction/real/SKILL.md', 'first');
            const real = FileUtils.getAbsolutePath('tmp/junction/real');
            const link = FileUtils.getAbsolutePath('tmp/junction/linked');
            fs.symlinkSync(real, link, 'junction');

            FileUtils.writeFile('tmp/junction/linked/SKILL.md', 'second');

            expect(fs.readFileSync(path.join(real, 'SKILL.md'), 'utf8')).toBe('second');
            expect(FileUtils.listFiles('tmp/junction/real')).toEqual(['SKILL.md']);
        });
    });

    /** A run killed between the writing and the renaming leaves the file it was writing through. */
    describe('listFiles is where the temporaries of a write are cleared', () => {

        test('neither names one nor leaves it lying there', () => {
            FileUtils.writeFile('tmp/left/note.md', 'first');
            leftLyingFor('tmp/left/note.md.999999.tmp', 5 * 60 * 1000);

            expect(FileUtils.listFiles('tmp/left')).toEqual(['note.md']);
            expect(onDisk('tmp/left')).toEqual(['note.md']);
        });

        /** Taking it would leave that write nothing to rename, and send it to writing in place. */
        test('leaves where it is the one another process is writing this moment', () => {
            FileUtils.writeFile('tmp/warm/note.md', 'first');
            leftLyingFor('tmp/warm/note.md.999999.tmp', 0);

            expect(FileUtils.listFiles('tmp/warm')).toEqual(['note.md']);
            expect(onDisk('tmp/warm')).toEqual(['note.md', 'note.md.999999.tmp']);
        });

        /**
         * Ours are named after a file that is here and a process that was. A file of the user's
         * that merely ends the same way is theirs, and so, for want of any way to tell, is one of
         * ours whose file was never written at all.
         */
        test('passes over what it has no way of telling is its own', () => {
            FileUtils.writeFile('tmp/mine/note.md', 'first');
            leftLyingFor('tmp/mine/note.md.backup.tmp', 5 * 60 * 1000);
            leftLyingFor('tmp/mine/gone.md.999999.tmp', 5 * 60 * 1000);

            expect(FileUtils.listFiles('tmp/mine').sort())
                .toEqual(['gone.md.999999.tmp', 'note.md', 'note.md.backup.tmp']);
        });
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

    describe('linkTarget', () => {

        test('says where a link leads', () => {
            const base = path.join(process.cwd(), 'tmp', 'linktarget');
            fs.mkdirSync(path.join(base, 'real'), {recursive: true});
            fs.symlinkSync(path.join(base, 'real'), path.join(base, 'linked'), 'junction');
            expect(FileUtils.linkTarget('tmp/linktarget/linked')?.replace(/\\/g, '/'))
                .toContain('tmp/linktarget/real');
        });

        test('answers nothing for a real folder or a path that is not there', () => {
            FileUtils.writeFile('tmp/linktarget-real/note.md', 'note');
            expect(FileUtils.linkTarget('tmp/linktarget-real')).toBeNull();
            expect(FileUtils.linkTarget('tmp/linktarget-nothing')).toBeNull();
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

    /** A file of another run's making, last touched the given while ago. */
    function leftLyingFor(file: string, millis: number): void {
        const lying = FileUtils.getAbsolutePath(file);
        fs.writeFileSync(lying, 'half of a write');
        const when = new Date(Date.now() - millis);
        fs.utimesSync(lying, when, when);
    }

    /** What the folder holds as the system tells it, past whatever `listFiles` chooses to say. */
    function onDisk(dir: string): string[] {
        return fs.readdirSync(FileUtils.getAbsolutePath(dir)).sort();
    }

    /** Four files of known ages in a folder of their own, `f1` the oldest, and where they lie. */
    function fourAgedFiles(dir: string): string {
        const base = path.join(process.cwd(), dir);
        for (let i = 1; i <= 4; i++) {
            FileUtils.writeFile(`${dir}/f${i}.txt`, `${i}`);
            fs.utimesSync(path.join(base, `f${i}.txt`), new Date(i * 1_000), new Date(i * 1_000));
        }
        return base;
    }

    test('enforceFileCountLimit removes the oldest files beyond the limit', () => {
        const base = fourAgedFiles('tmp/limited');
        FileUtils.enforceFileCountLimit('tmp/limited', 2);
        expect(fs.readdirSync(base).sort()).toEqual(['f3.txt', 'f4.txt']);
    });

    /**
     * On windows the file a running process has open cannot be deleted, and one of those is exactly
     * what this folder holds: room is what is being asked for, so the ones that can go, go.
     */
    test('enforceFileCountLimit passes over a file that will not go', () => {
        const dir = 'tmp/held-open';
        const base = fourAgedFiles(dir);
        const held = path.join(base, 'f1.txt');
        const rmSync = fs.rmSync;
        vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
            if (String(target) === held) {
                throw new Error('EBUSY: resource busy or locked');
            }
            rmSync(target, options);
        });
        try {
            FileUtils.enforceFileCountLimit(dir, 2);
        } finally {
            // Restored here and not after the assertions: a spy on rmSync left standing would
            // outlive this test and take the temp folder of the whole file with it.
            vi.restoreAllMocks();
        }
        expect(fs.readdirSync(base).sort()).toEqual(['f1.txt', 'f3.txt', 'f4.txt']);
    });

    /** The one it is told to keep counts towards the limit and is never the one that goes. */
    test('enforceFileCountLimit keeps what it is told to keep', () => {
        const base = fourAgedFiles('tmp/kept');
        FileUtils.enforceFileCountLimit('tmp/kept', 2, name => name === 'f1.txt');
        expect(fs.readdirSync(base).sort()).toEqual(['f1.txt', 'f3.txt', 'f4.txt']);
    });

    /**
     * Asking after a process can go wrong the way anything can. No telling whether a file is wanted
     * is no reason to delete it, and none to raise out of a call whose whole promise is that it
     * will not: the caller of this one is about to log a line, most likely about something else
     * that already went wrong.
     */
    test('enforceFileCountLimit keeps what it cannot ask about', () => {
        const base = fourAgedFiles('tmp/unaskable');
        expect(() => FileUtils.enforceFileCountLimit('tmp/unaskable', 2, name => {
            if (name === 'f1.txt') {
                throw new Error('no telling');
            }
            return false;
        })).not.toThrow();
        expect(fs.readdirSync(base).sort()).toEqual(['f1.txt', 'f3.txt', 'f4.txt']);
    });

    /**
     * Called to make room before something is written, so a caller that cannot have room is still a
     * caller with something to write. The logger calls it, and a throw from here would come out of
     * whatever line was being logged.
     */
    test('enforceFileCountLimit says nothing of a folder it cannot read', () => {
        expect(() => FileUtils.enforceFileCountLimit('tmp/never-made', 2)).not.toThrow();
        const dir = 'tmp/unreadable';
        FileUtils.writeFile(`${dir}/a.txt`, 'a');
        vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });
        try {
            expect(() => FileUtils.enforceFileCountLimit(dir, 0)).not.toThrow();
        } finally {
            vi.restoreAllMocks();
        }
        expect(fs.readdirSync(path.join(process.cwd(), dir))).toEqual(['a.txt']);
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

        function moduleDirWithSkills(name: string, skills: string[]): string {
            const moduleDir = path.join(tempDir, 'module', name);
            for (const skill of skills) {
                const skillDir = path.join(moduleDir, 'resources', 'skills', skill);
                fs.mkdirSync(skillDir, {recursive: true});
                fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'shipped');
            }
            return moduleDir;
        }

        /** Skills are added release by release, into a folder every install has had for ages. */
        test('lays down the resources of a folder the destination is missing', () => {
            const moduleDir = moduleDirWithSkills('added', ['old-one', 'new-one']);
            FileUtils.writeFile('tmp/added/skills/old-one/SKILL.md', 'shipped');

            FileUtils.copyResource(moduleDir, 'skills', 'tmp/added');

            expect(FileUtils.readFile('tmp/added/skills/new-one/SKILL.md')).toBe('shipped');
        });

        test('leaves what the user made of a resource in a folder it fills in', () => {
            const moduleDir = moduleDirWithSkills('edited', ['old-one', 'new-one']);
            FileUtils.writeFile('tmp/edited/skills/old-one/SKILL.md', 'mine');

            FileUtils.copyResource(moduleDir, 'skills', 'tmp/edited');

            expect(FileUtils.readFile('tmp/edited/skills/old-one/SKILL.md')).toBe('mine');
        });

        /** One of their own sits in the same folder, and it answers to no shipped name. */
        test('leaves a folder of the user own alone', () => {
            const moduleDir = moduleDirWithSkills('theirs', ['old-one']);
            FileUtils.writeFile('tmp/theirs/skills/theirs/SKILL.md', 'mine');

            FileUtils.copyResource(moduleDir, 'skills', 'tmp/theirs');

            expect(FileUtils.readFile('tmp/theirs/skills/theirs/SKILL.md')).toBe('mine');
            expect(FileUtils.readFile('tmp/theirs/skills/old-one/SKILL.md')).toBe('shipped');
        });

        /**
         * This runs on every start, and removing a skill is an operation of its own. Laying one
         * down whenever it is missing would undo every removal by the next start.
         */
        test('does not lay a resource down again once the user has removed it', () => {
            const moduleDir = moduleDirWithSkills('removed', ['old-one']);
            FileUtils.copyResource(moduleDir, 'skills', 'tmp/removed');
            FileUtils.deleteDir('tmp/removed/skills/old-one');

            FileUtils.copyResource(moduleDir, 'skills', 'tmp/removed');

            expect(FileUtils.exists('tmp/removed/skills/old-one')).toBe(false);
        });

        test('lays a resource down again where the folder itself was removed', () => {
            const moduleDir = moduleDirWithSkills('wiped', ['old-one']);
            FileUtils.copyResource(moduleDir, 'skills', 'tmp/wiped');
            FileUtils.deleteDir('tmp/wiped/skills');

            FileUtils.copyResource(moduleDir, 'skills', 'tmp/wiped');

            expect(FileUtils.readFile('tmp/wiped/skills/old-one/SKILL.md')).toBe('shipped');
        });

        /** The point of filling a folder in: a removal must not cost the release after it. */
        test('still lays down what the release added after a removal', () => {
            const first = moduleDirWithSkills('release', ['old-one']);
            FileUtils.copyResource(first, 'skills', 'tmp/release');
            FileUtils.deleteDir('tmp/release/skills/old-one');
            const next = moduleDirWithSkills('release-next', ['old-one', 'new-one']);

            FileUtils.copyResource(next, 'skills', 'tmp/release');

            expect(FileUtils.readFile('tmp/release/skills/new-one/SKILL.md')).toBe('shipped');
            expect(FileUtils.exists('tmp/release/skills/old-one')).toBe(false);
        });

        test('counts what a folder was first laid down with, having written none of it before', () => {
            const moduleDir = moduleDirWithSkills('fresh', ['old-one']);
            FileUtils.copyResource(moduleDir, 'skills', 'tmp/fresh');
            expect(JSON.parse(FileUtils.readFile('tmp/fresh/.skills.planted'))).toEqual(['old-one']);
        });

        /** Nothing on disk tells a skill removed before there was a record from one never had. */
        test('lays down what an older install has never been offered', () => {
            const moduleDir = moduleDirWithSkills('older', ['old-one', 'new-one']);
            FileUtils.writeFile('tmp/older/skills/old-one/SKILL.md', 'mine');

            FileUtils.copyResource(moduleDir, 'skills', 'tmp/older');

            expect(FileUtils.readFile('tmp/older/skills/new-one/SKILL.md')).toBe('shipped');
            expect(FileUtils.readFile('tmp/older/skills/old-one/SKILL.md')).toBe('mine');
            expect(JSON.parse(FileUtils.readFile('tmp/older/.skills.planted')).sort())
                .toEqual(['new-one', 'old-one']);
        });

        test('reads a record of nothing out of one that cannot be parsed', () => {
            const moduleDir = moduleDirWithSkills('broken', ['old-one']);
            FileUtils.writeFile('tmp/broken/.skills.planted', 'not json');
            FileUtils.writeFile('tmp/broken/skills/other/SKILL.md', 'mine');

            FileUtils.copyResource(moduleDir, 'skills', 'tmp/broken');

            expect(FileUtils.readFile('tmp/broken/skills/old-one/SKILL.md')).toBe('shipped');
        });

        /** The record sits beside the folder: one inside it would be read as a skill of its own. */
        test('keeps the record out of the folder it counts', () => {
            const moduleDir = moduleDirWithSkills('beside-it', ['old-one']);
            FileUtils.copyResource(moduleDir, 'skills', 'tmp/beside-it');
            expect(fs.readdirSync(path.join(process.cwd(), 'tmp/beside-it/skills'))).toEqual(['old-one']);
        });
    });
});