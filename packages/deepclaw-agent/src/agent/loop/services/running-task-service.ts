import { randomUUID } from 'node:crypto';
import { type RunningTask } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';
import { type OneLoopContext } from '../../definitions/definitions';

/**
 * The tasks being worked at this very moment, in two books by who is working them: the task loops
 * they were handed to, and the main loops working them themselves. Nothing of this outlives the
 * process, which is the point: a run that died with it is not running anymore, and the status a
 * task carries cannot tell that apart on its own.
 */
class RunningTaskServiceImpl {

    /**
     * The tasks handed out to task loops, by the run each was handed out under. A run is a thing of
     * its own from its first line to its last, so the entry lasts exactly as long as it does.
     */
    private static taskLoopRuns: Map<string, RunningTask> = new Map();

    /**
     * The tasks main loops are working themselves, by the loop working them. A turn is the whole of
     * what one of these lasts: the loop says it while answering and the answer ending takes it away
     * again, so nothing here can be left behind by a loop that moved on to something else, and
     * nothing has to be reconciled against the board.
     *
     * Filed by the loop, which is the run id these carry as well -- there is nothing else to hold on
     * to, no subagent having been spawned to stand for the work. One entry per loop falls out of
     * that key, which is one task at a time, and a turn ending finds its own without looking. What
     * is asked of this map is whether some task is being worked, and that is a walk over it: one
     * entry per conversation is the whole of how large it gets.
     */
    private static mainLoopRuns: Map<string, RunningTask> = new Map();

    private static isOn(runs: Iterable<RunningTask>, projectId: string, taskId: string): boolean {
        return [...runs].some(run => run.projectId === projectId && run.taskId === taskId);
    }

    /** The handle to hand back on the way out, so two runs of one task cannot retire each other. */
    public static startTaskLoopRun(task: Omit<RunningTask, 'runId'>): string {
        const runId = randomUUID();
        this.taskLoopRuns.set(runId, {...task, runId});
        return runId;
    }

    public static finishTaskLoopRun(runId: string): void {
        this.taskLoopRuns.delete(runId);
    }

    /**
     * A main loop taking a task on for the turn it is in. One task at a time, a conversation being
     * one thing answered at a time, so the last word of a loop is the one that stands for it. Two
     * loops saying it of one task both stand: each of them is working it, and each goes when its own
     * turn ends.
     *
     * The loop is the handle. Nothing here is ever looked up by one from outside, this being work
     * nobody hands a receipt back for, but the browsers tell the rows of their list apart by it: a
     * fresh one every time would draw the same work as another row whenever a run said twice what
     * it is on.
     */
    public static startMainLoopRun(loopId: string, task: Omit<RunningTask, 'runId'>): void {
        this.mainLoopRuns.set(loopId, {...task, runId: loopId});
    }

    /** A turn ending, and with it whatever that loop had said it was working. */
    public static endMainLoopRun(loopId: string): boolean {
        return this.mainLoopRuns.delete(loopId);
    }

    /**
     * A loop handing on the task it was working itself, which it is no longer the one on. Its own
     * entry and no other: another main loop saying it works this task is another loop's word about
     * itself, true until its own turn ends and nothing for this one to take back. And its own only
     * where that is the task it stands on, a loop that took up something else having said nothing
     * about this one.
     */
    public static dropMainLoopRun(loopId: string, projectId: string, taskId: string): boolean {
        const run = this.mainLoopRuns.get(loopId);
        if (run?.projectId !== projectId || run.taskId !== taskId) {
            return false;
        }
        return this.mainLoopRuns.delete(loopId);
    }

    /** Whether anybody is on that task right now, which is the whole of what the card spins for. */
    public static isRunning(projectId: string, taskId: string): boolean {
        return this.isOn(this.mainLoopRuns.values(), projectId, taskId)
            || this.isTaskLoopRunning(projectId, taskId);
    }

    /**
     * Whether a task loop has it, which is the narrower question and the one handing a task out has
     * to ask: a main loop working the task itself is the very loop asking, and no reason to refuse
     * it.
     */
    public static isTaskLoopRunning(projectId: string, taskId: string): boolean {
        return this.isOn(this.taskLoopRuns.values(), projectId, taskId);
    }

    public static getRunningTasks(): RunningTask[] {
        return [...this.taskLoopRuns.values(), ...this.mainLoopRuns.values()];
    }
}

export const RunningTaskService = globalize('RunningTaskService', RunningTaskServiceImpl);

/**
 * The whole list every time, which is what the browsers replace theirs with. Said the same way by
 * everything that moves a run, so that no two of them can say it differently.
 */
export function fireRunningTasksEvent(context: OneLoopContext): void {
    context.actions.agentHandler.onInfoEvent({
        eventType: 'updateRunningTasks',
        content: RunningTaskService.getRunningTasks(),
    });
}
