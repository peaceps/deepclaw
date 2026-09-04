import process from 'node:process';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../test-support/one-loop-context';
import {ProjectManager} from './services/project-manager';
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

const mocks = vi.hoisted(() => ({
    isPathInWorkspace: vi.fn<(path: string) => boolean>(),
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
            getWorkingDir: () => DATA_ROOT,
            readDir: () => ({}),
        },
        getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
        getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    };
});

const workingDirOf = vi.spyOn(ProjectManager, 'workingDirOf');

beforeEach(() => {
    vi.clearAllMocks();
    workingDirOf.mockReturnValue(undefined);
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

    test('asks after nothing but the workspace for a run with no folder of its own', () => {
        const context = newTestContext({role: 'project', projectId: 'p1'});
        expect(inRunWorkspace(context, `${REPO}/src/index.ts`)).toBe(false);
        expect(inRunWorkspace(context, `${DATA_ROOT}/notes.md`)).toBe(true);
    });
});
