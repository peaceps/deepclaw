import process from 'node:process';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../test-support/one-loop-context';
import {ProjectManager} from './services/project-manager';
import {WorktreeService} from './services/worktree-service';
import {inRunWorkspace, projectWorkDir, runPath, runWorkingDir} from './run-dir';

/**
 * Two folders that are really rooted, built off the one folder the test knows the shape of.
 * Nothing is read or written under either: a rooted path with no drive on it is a path on whatever
 * drive the test runs from, and resolving one would move it while the folder it is compared
 * against stayed where it was written.
 */
const HOME = process.cwd().replaceAll('\\', '/');
const DATA_ROOT = `${HOME}/home/.deepclaw`;
const REPO = `${HOME}/home/code/app`;
const WORKTREE = `${DATA_ROOT}/.projects/p1/worktrees/t1`;

const mocks = vi.hoisted(() => ({
    isPathInWorkspace: vi.fn<(path: string) => boolean>(),
    isDir: vi.fn<(path: string) => boolean>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('@deepclaw/node-utils')>();
    const real = original.FileUtils;
    return {
        ...original,
        FileUtils: {
            // The reading of paths is the real one: what a name means and whether it lies inside a
            // folder is the whole of what this module is made of, and faked here it would be the
            // fake being tested. Only the two roots are ours, a test having neither on disk.
            getAbsolutePath: real.getAbsolutePath.bind(real),
            isPathInside: real.isPathInside.bind(real),
            isPathInWorkspace: mocks.isPathInWorkspace,
            isDir: mocks.isDir,
            getWorkingDir: () => DATA_ROOT,
            readDir: () => ({}),
        },
        getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
        getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    };
});

const workingDirOf = vi.spyOn(ProjectManager, 'workingDirOf');
const worktreeOf = vi.spyOn(WorktreeService, 'worktreeOf');

beforeEach(() => {
    vi.clearAllMocks();
    workingDirOf.mockReturnValue(undefined);
    worktreeOf.mockReturnValue(undefined);
    mocks.isDir.mockReturnValue(false);
    mocks.isPathInWorkspace.mockImplementation(path => path.startsWith(DATA_ROOT));
});

describe('projectWorkDir', () => {

    test('answers with the folder the project of this run works in', () => {
        workingDirOf.mockReturnValue(REPO);
        expect(projectWorkDir('project', 'p1')).toBe(REPO);
        expect(workingDirOf).toHaveBeenCalledExactlyOnceWith('p1');
    });

    test('answers with nothing for a project that named no folder', () => {
        expect(projectWorkDir('project', 'p1')).toBeUndefined();
    });

    /** A task loop and every sub loop under it work where the project of that task works. */
    test('reads the project off the task a spawned run was handed', () => {
        workingDirOf.mockReturnValue(REPO);
        expect(projectWorkDir('agent', '', {projectId: 'p9', taskId: 'design'})).toBe(REPO);
        expect(workingDirOf).toHaveBeenCalledExactlyOnceWith('p9');
    });

    /**
     * A task that took a checkout of its own works in it and not where the project works, which is
     * the whole of what a checkout is for: the other tasks of that project are in the folder below
     * at the same moment.
     */
    test('answers with the checkout of the task ahead of the folder of the project', () => {
        workingDirOf.mockReturnValue(REPO);
        worktreeOf.mockReturnValue({dir: WORKTREE, branch: 'deepclaw/parser-t1'});
        mocks.isDir.mockReturnValue(true);
        expect(projectWorkDir('project', 'p1', {projectId: 'p1', taskId: 't1'})).toBe(WORKTREE);
        expect(worktreeOf).toHaveBeenCalledExactlyOnceWith({projectId: 'p1', taskId: 't1'});
    });

    /** Taken away by the user since: the task works where it worked before it ever asked for one. */
    test('falls back to the project folder when the checkout is no longer there', () => {
        workingDirOf.mockReturnValue(REPO);
        worktreeOf.mockReturnValue({dir: WORKTREE, branch: 'deepclaw/parser-t1'});
        mocks.isDir.mockReturnValue(false);
        expect(projectWorkDir('project', 'p1', {projectId: 'p1', taskId: 't1'})).toBe(REPO);
    });

    /** Everything of a run that is on no task, which is every chat and every project loop. */
    test('asks after no checkout for a run that was handed no task', () => {
        workingDirOf.mockReturnValue(REPO);
        expect(projectWorkDir('project', 'p1')).toBe(REPO);
        expect(worktreeOf).not.toHaveBeenCalled();
    });

    /**
     * A scheduled run carries the id of a cron task in the field a project id lives in. Asked for
     * a project by that id the board would answer with none, but it is not asked at all: a cron
     * task is no project and never had a folder to name.
     */
    test('asks the board nothing for a scheduled run', () => {
        expect(projectWorkDir('cron', 'c1')).toBeUndefined();
        expect(workingDirOf).not.toHaveBeenCalled();
    });

    test('asks the board nothing for a chat about no project', () => {
        expect(projectWorkDir('agent', '')).toBeUndefined();
        expect(workingDirOf).not.toHaveBeenCalled();
    });
});

describe('runWorkingDir', () => {

    test('is the folder of the project where there is one', () => {
        workingDirOf.mockReturnValue(REPO);
        expect(runWorkingDir(newTestContext({role: 'project', projectId: 'p1'}))).toBe(REPO);
    });

    test('is the data root where the project named no folder', () => {
        expect(runWorkingDir(newTestContext({role: 'project', projectId: 'p1'}))).toBe(DATA_ROOT);
    });

    /**
     * A reading is built with the task it reads, so it looks at the work where the work is. Nothing
     * of a task that worked in a checkout of its own is in the folder below: a reader sent there
     * would read the code as it stood before the task started and say it had done nothing.
     */
    test('sends a reading of the task to the checkout that task worked in', () => {
        workingDirOf.mockReturnValue(REPO);
        worktreeOf.mockReturnValue({dir: WORKTREE, branch: 'deepclaw/parser-t1'});
        mocks.isDir.mockReturnValue(true);
        expect(runWorkingDir(newTestContext({
            role: 'project', projectId: 'p1', loopKind: 'review',
            assignedTask: {projectId: 'p1', taskId: 't1'},
        }))).toBe(WORKTREE);
    });
});

describe('runPath', () => {

    test('reads a relative name against the folder the run works in', () => {
        workingDirOf.mockReturnValue(REPO);
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(runPath(context, 'src/index.ts')).toBe(`${REPO}/src/index.ts`);
    });

    test('reads a relative name against the data root for a run working there', () => {
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(runPath(context, 'notes.md')).toBe(`${DATA_ROOT}/notes.md`);
    });

    test('leaves a path that names itself in full alone', () => {
        workingDirOf.mockReturnValue(REPO);
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(runPath(context, '/var/log/system.log')).toBe('/var/log/system.log');
    });
});

describe('inRunWorkspace', () => {

    test('lets a run reach into the folder its project works in', () => {
        workingDirOf.mockReturnValue(REPO);
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(inRunWorkspace(context, `${REPO}/src/index.ts`)).toBe(true);
        expect(inRunWorkspace(context, 'src/index.ts')).toBe(true);
    });

    test('lets a run reach the data root as well, wherever it works', () => {
        workingDirOf.mockReturnValue(REPO);
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(inRunWorkspace(context, `${DATA_ROOT}/.projects/p1/files/report.md`)).toBe(true);
    });

    /** The folder of the project is one folder, not a way out of every folder. */
    test('leaves everything else outside', () => {
        workingDirOf.mockReturnValue(REPO);
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(inRunWorkspace(context, `${HOME}/home/.ssh/id_rsa`)).toBe(false);
        expect(inRunWorkspace(context, `${REPO}/../secrets/keys.json`)).toBe(false);
    });

    /**
     * The checkout is where this run works, so it is what it may reach into. The repository it was
     * taken from is where the other tasks of the project are working at that same moment, and this
     * run is asked about before it touches anything in there.
     */
    test('holds a task working in a checkout to that checkout', () => {
        workingDirOf.mockReturnValue(REPO);
        worktreeOf.mockReturnValue({dir: WORKTREE, branch: 'deepclaw/parser-t1'});
        mocks.isDir.mockReturnValue(true);
        const context = newTestContext({
            role: 'project', projectId: 'p1', assignedTask: {projectId: 'p1', taskId: 't1'},
        });
        expect(inRunWorkspace(context, 'src/index.ts')).toBe(true);
        expect(inRunWorkspace(context, `${WORKTREE}/src/index.ts`)).toBe(true);
        expect(inRunWorkspace(context, `${REPO}/src/index.ts`)).toBe(false);
    });

    test('asks after nothing but the workspace for a run with no folder of its own', () => {
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(inRunWorkspace(context, `${REPO}/src/index.ts`)).toBe(false);
        expect(inRunWorkspace(context, `${DATA_ROOT}/notes.md`)).toBe(true);
    });
});
