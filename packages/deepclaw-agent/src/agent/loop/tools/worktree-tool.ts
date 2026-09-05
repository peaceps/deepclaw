import { FileUtils, runCommand } from '@deepclaw/node-utils';
import { type ToolDesc } from '../../definitions/tool-definitions';
import {
    type AssignedTask, type OneLoopContext, RUN_COMMAND_FOOT_PRINT
} from '../../definitions/definitions';
import { projectWorktreeDir } from '../../paths';
import { ProjectManager } from '../services/project-manager';
import { WorktreeService } from '../services/worktree-service';

type WorktreeInput = {
    from?: string;
}

/**
 * What an id may be for its folder to be named after it, and what a ref may be to be handed to a
 * shell. Ids are uuids made in the project service and no tool an agent holds can name one, so this
 * is for the day that stops being true; the ref comes straight from a model and every day is that
 * day. What each allows is said rather than what it refuses -- a list of the ways out is a list to
 * have left something off.
 *
 * A shape is the whole of what keeps a shell from reading a value as anything but a value. It is
 * not the whole of what keeps a command from reading one as a flag: both refusals a ref needs on
 * top of its shape are made of characters allowed here, and they are made below where the ref is.
 */
const ID_SHAPE = /^[A-Za-z0-9_-]+$/;
const REF_SHAPE = /^[A-Za-z0-9._/-]+$/;

export const worktreeTool: ToolDesc<WorktreeInput> = {
    tool: {
        name: 'work_in_worktree',
        description: `Take a git worktree of the project's repository for this task and work in it
from here on: a checkout of its own, on a branch of its own, so that nothing you do lands in the
same files as the other tasks being worked at the same time.
Call this before you change anything if this task touches code, and the repository is where the
project works. Tasks of one project go out at the same time and share that repository otherwise:
edits land on top of each other and commits interleave, and no amount of care inside one task
prevents it.
Afterwards your commands start in the checkout, a relative path you write lands in it, and the
project's own folder is outside what you may touch without asking. The checkout and its branch are
left standing when the task ends -- they are what the user gets of this work -- so commit what you
do, and name the branch in what you report.
Calling it twice is calling it once: the checkout of a task is the same folder every time, and a
task taken up again is taken up where its work was left.`,
        schema: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {
                from: {
                    type: 'string',
                    description: `The branch or commit to start the work from. Whatever the
repository has checked out where the project works, by default. Name the branch of a task this one
waited for where the work needs what that task did and the branch of it was never merged -- a
report of a task that worked in a checkout of its own says which branch that is.`,
                },
            },
            required: [],
        },
    },
    agentMode: ['agent'],
    // One checkout per task, and every call after the first hands back the one already there, so
    // two of them in a turn cannot make a mess. Held to one at a time all the same: what the second
    // would be answered with is what the first is about to create.
    parallelSafe: false,
    // The task loop and no other. A sub loop carries the task of the loop above it and would be
    // asking for the same folder, but it is not the run that keeps working there: the dir would
    // change under the loop that spawned it, decided by a run that is about to end. The one on the
    // task settles where the task works, and everything under it follows by carrying the same task.
    loopKinds: ['task'],
    // A repository named by a project is the whole of what this works on. A scheduled run carries a
    // cron id where the project would be and an ordinary chat carries no project at all.
    roles: ['project'],
    // No guard. What it does to the user's repository is add a branch: their checkout is not
    // touched, nothing of theirs moves, and the folder it writes is inside our own data. Asked
    // about, it would ask once per task of a project working in parallel, for the answer that
    // leaves the work safer than every alternative it has.
    invoke: execute,
}

async function execute(input: WorktreeInput, context: OneLoopContext): Promise<string> {
    const task = requireTask(context);
    const repo = ProjectManager.workingDirOf(task.projectId);
    if (!repo) {
        throw new Error('This project works in the deepclaw data folder, and there is no repository '
            + 'there to take a checkout of. A folder of its own is named on the board, by the user '
            + 'or with update_project, and only before the project starts -- so this task works '
            + 'where it stands. Say so in your report rather than working around it.');
    }
    const from = requireRef(input.from);
    const gitDir = await requireRepo(repo, context);
    const dir = requireShellSafe(FileUtils.getAbsolutePath(worktreeFolder(task)));
    if (FileUtils.isDir(dir)) {
        return standing(task, dir, await branchInPlace(dir, gitDir, context));
    }
    const branch = branchOf(task);
    await prune(repo, context);
    const add = await addCommand(repo, dir, branch, from, context);
    // Before the command, the way a command tool files one: what this line says is that the
    // repository was touched, and one that died halfway touched it hardest of all.
    context.actions.addFootPrint({type: RUN_COMMAND_FOOT_PRINT, content: add});
    try {
        await runCommand(add, context.abortSignal, repo);
    } catch (error: any) {
        throw new Error(`No checkout was made for this task: ${error?.message || 'git said nothing'}. `
            + 'You are still working where the project does, so take care about what else is being '
            + 'worked on in there.');
    }
    WorktreeService.remember(task, {dir, branch});
    return `Working in a checkout of this task's own from here on: ${dir}
On branch ${branch}, taken from ${from || 'what the repository had checked out'}.
Your commands start in there and a relative path you write lands in there. The project's own folder,
${repo}, is outside what this run may touch without the user being asked.
The checkout and the branch stay when this task ends, so commit your work in there and name the
branch ${branch} in what you report.`;
}

/**
 * The task this run is on. A task loop is built with one and this tool is handed to no other kind of
 * loop, so there is nothing here to go wrong -- said out loud because the whole of this tool hangs
 * off it: the folder is named for the task, the branch is named for the task, and the run works
 * there by carrying the task rather than by being told a path.
 */
function requireTask(context: OneLoopContext): AssignedTask {
    if (!context.assignedTask) {
        throw new Error('This run is on no task of the board, so there is no task to check out for.');
    }
    return context.assignedTask;
}

/**
 * Two things are refused on top of the shape, both because they are made of allowed characters:
 * `..`, which git reads as a range rather than as a name, and a leading dash, which a command
 * reads as a flag of its own rather than as an argument. `-f` gets through every quote there is
 * and lands as --force on the very command below.
 */
function requireRef(from?: string): string | undefined {
    if (!from) {
        return undefined;
    }
    if (!REF_SHAPE.test(from) || from.includes('..') || from.startsWith('-')) {
        throw new Error(`"${from}" is nothing this can start a branch from. Name a branch or a `
            + 'commit, plainly.');
    }
    return from;
}

/**
 * The folder is ours and the task's id names it, but it is not ours the whole way down: the data
 * root it hangs under is wherever the user pointed deepclaw, and from here it goes into a line a
 * shell reads. A quote or a `$` in it breaks out of the quoting exactly as a ref would, so the one
 * value here that the shapes above cannot vouch for is asked the same question in its own terms.
 */
function requireShellSafe(dir: string): string {
    if (/["$`\\]/.test(dir)) {
        throw new Error(`The deepclaw data folder is at a path a command cannot be handed safely `
            + `(${dir}), so no checkout can be made under it. Work where you stand, and tell the `
            + 'user: only they can move that folder somewhere plainer.');
    }
    return dir;
}

/**
 * Where the repository of this project keeps itself: both the answer to whether it is a repository
 * at all, and what a checkout of it is recognised by further down.
 *
 * The common git dir and not the one this folder keeps of its own, because those two part company
 * exactly where the user works in worktrees themselves. A project pointed at a linked worktree has
 * its own git dir under the main repository's, while every checkout we add is registered under
 * that main one -- so asked for its own, this would hold a name that nothing we ever make can
 * match, and a run coming back to its own checkout would be told to go and clear it away.
 *
 * Asked for as an absolute path, which is a spelling of the question that needs git 2.31: git
 * answers with a relative path in a main repository and an absolute one in a linked worktree, and
 * two sides of a comparison have to be answers of one shape. The refusal names the version, there
 * being three ways to have no answer here and no telling them apart from out here.
 */
async function requireRepo(repo: string, context: OneLoopContext): Promise<string> {
    try {
        return answerOf(await runCommand(
            'git rev-parse --path-format=absolute --git-common-dir', context.abortSignal, repo
        ));
    } catch {
        throw new Error(`Git cannot say where the repository at ${repo} keeps itself, so there is `
            + 'no checkout to take: that folder is no repository, or the git on this machine is '
            + 'missing or older than 2.31. Work where you stand, and say in your report that the '
            + 'work shares that folder with whatever else is being worked on.');
    }
}

/**
 * The registrations of checkouts whose folders are gone, cleared away before another is made.
 *
 * A folder the user deleted by hand leaves its registration standing in the repository, and git
 * refuses to add a worktree at a path it still has one for: "missing but already registered". Both
 * ways of adding one below walk into it, so without this a task whose checkout the user cleared
 * away could never be given another -- and it would go back to working in the shared repository,
 * which is the one thing this tool exists to prevent.
 *
 * `add -f` gets past it too and is not what is used: --force also switches off the check that the
 * branch is not already checked out somewhere else, and the somewhere else that check usually
 * means is the user's own working copy sitting on that branch.
 *
 * It clears every registration whose folder is gone rather than this task's alone. What else is in
 * that list is the checkouts of projects that have been put away: archiving moves .projects/<id>
 * whole, the checkouts under it included, and leaves the registration pointing at nothing. Such a
 * folder stops being a git checkout when this runs, while the branch and every commit on it stay
 * in the repository -- nothing of the work was ever in the registration.
 */
async function prune(repo: string, context: OneLoopContext): Promise<void> {
    try {
        await runCommand('git worktree prune', context.abortSignal, repo);
    } catch {
        // Bookkeeping nobody can see, so there is nothing to report of it failing: the add below
        // runs either way and says whatever it walks into.
    }
}

/** The line git answered with, which comes ahead of any warning it wrote beside it. */
function answerOf(result: {output: string}): string {
    return result.output.split('\n').map(line => line.trim()).find(Boolean) ?? '';
}

/**
 * A checkout of a branch that exists already is a checkout of that branch, and `-b` on it is what
 * git refuses. Asked of the refs rather than read off that refusal, which arrives as prose in
 * whatever language the machine is set to.
 *
 * The branch is there where the task worked before and its checkout has since been taken away, and
 * that is a task picked up where it was left: the work already on it is the reason to want it back.
 */
async function addCommand(
    repo: string, dir: string, branch: string, from: string | undefined, context: OneLoopContext
): Promise<string> {
    try {
        await runCommand(`git rev-parse --verify --quiet refs/heads/${branch}`, context.abortSignal, repo);
        return `git worktree add "${dir}" ${branch}`;
    } catch {
        return `git worktree add -b ${branch} "${dir}"${from ? ` ${from}` : ''}`;
    }
}

/**
 * What the checkout standing there is on, and the proof that it is a checkout of this repository
 * before its word is taken for anything.
 *
 * The branch is asked of the folder rather than worked out again from the task: a task renamed
 * since would name a branch nobody ever made, and a report is worth nothing if the branch in it is
 * not the one the work is on. The repository is asked because the refusal below says which one it
 * means, and because what is at that path is not always ours -- a folder the user put something
 * in, or the tails of two task ids that met.
 *
 * Compared as git says it on either side rather than by reading the two paths ourselves: the git
 * dir of a checkout is the git dir of its repository with the name of the checkout under it, and
 * two answers from git can be compared where a path from git and a path from a person cannot.
 */
async function branchInPlace(
    dir: string, gitDir: string, context: OneLoopContext
): Promise<string> {
    if (!(await gitDirOf(dir, context)).startsWith(`${gitDir}/worktrees/`)) {
        throw new Error(`${dir} is where the checkout of this task belongs, and what is in there is `
            + 'no checkout of this repository. The user has to clear that folder before this task '
            + 'can work in one -- tell them, and work where you stand until they have.');
    }
    return answerOf(await runCommand('git rev-parse --abbrev-ref HEAD', context.abortSignal, dir));
}

/** Where a folder keeps its git, and nothing where it has none to keep. */
async function gitDirOf(dir: string, context: OneLoopContext): Promise<string> {
    try {
        return answerOf(
            await runCommand('git rev-parse --absolute-git-dir', context.abortSignal, dir)
        );
    } catch {
        return '';
    }
}

function standing(task: AssignedTask, dir: string, branch: string): string {
    WorktreeService.remember(task, {dir, branch});
    return `This task has a checkout of its own already, and is working in it: ${dir}
On branch ${branch}, with whatever was left in there last time. Commit your work in there and name
the branch ${branch} in what you report.`;
}

/**
 * Named for the task, so that the same task asks its way back to the same folder every time, and
 * two tasks never share one.
 */
function worktreeFolder(task: AssignedTask): string {
    if (!ID_SHAPE.test(task.projectId) || !ID_SHAPE.test(task.taskId)) {
        throw new Error('This task is filed under a name that cannot name a folder of its own.');
    }
    return projectWorktreeDir(task.projectId, task.taskId);
}

/**
 * The branch a task's work goes on: ours by the prefix, the task by the words of its title, and the
 * one task by the tail of its id. All three earn their place -- the prefix so the user can see at a
 * glance which branches of their repository we made, the title so they can tell them apart without
 * looking any of them up, the id because two tasks are often called nearly the same thing.
 *
 * A title with nothing a branch name can carry, which every title in a language without an alphabet
 * of this kind is, leaves the id to say it alone.
 */
function branchOf(task: AssignedTask): string {
    const title = ProjectManager.getTask(task.projectId, task.taskId)?.title ?? '';
    const words = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
    return `deepclaw/${words ? `${words}-` : 'task-'}${task.taskId.slice(0, 8)}`;
}
