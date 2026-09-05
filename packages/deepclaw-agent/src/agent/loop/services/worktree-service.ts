import { globalize } from '@deepclaw/utils';
import { type AssignedTask } from '../../definitions/definitions';

/** Where a task works and the branch its work is on, for a task that asked for a checkout of its own. */
export type TaskWorktree = {
    /** Absolute, because this is what a command starts in and what a written name is read against. */
    dir: string;
    branch: string;
};

/**
 * The tasks working in a checkout of their own, by the task rather than by the run.
 *
 * By the task, because that is the question everything downstream asks: a task loop and every sub
 * loop under it carry the same task and work in the same folder, and a task picked up again after a
 * report is picked up where its work was left. A run is the shorter-lived of the two and the wrong
 * key for a folder that outlives it.
 *
 * Nothing here is written to disk, and nothing here deletes anything. The checkout on disk is the
 * truth: this is the note that saves asking git where it is, so a process that came up without the
 * note finds the folder standing and takes it up again. What is in it belongs to whoever asked for
 * it -- a branch and, often, work not yet committed -- and bookkeeping going out of scope is no
 * reason for any of that to go.
 */
class WorktreeServiceImpl {

    private static worktrees: Map<string, TaskWorktree> = new Map();

    private static keyOf(task: AssignedTask): string {
        return `${task.projectId}/${task.taskId}`;
    }

    public static remember(task: AssignedTask, worktree: TaskWorktree): void {
        this.worktrees.set(this.keyOf(task), worktree);
    }

    public static worktreeOf(task: AssignedTask): TaskWorktree | undefined {
        return this.worktrees.get(this.keyOf(task));
    }
}

export const WorktreeService = globalize('WorktreeService', WorktreeServiceImpl);
