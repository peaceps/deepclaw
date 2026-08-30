import { randomUUID } from 'node:crypto';
import { type RunningTask } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';
import { type OneLoopContext } from '../../definitions/definitions';
import { ProjectManager } from './project-manager';

/**
 * The tasks being worked at this very moment. Nothing of this outlives the process, which is the
 * point: a run that died with it is not running anymore, and the status a task carries cannot tell
 * that apart on its own.
 */
class RunningTaskServiceImpl {

    private static runs: Map<string, RunningTask> = new Map();

    /**
     * What a loop said it is working with its own hands, by the id of that loop. A subagent is a run
     * from the first line of it to the last, so the tool that spawns one holds its own run open
     * across the await; a loop working a task itself is answering the user one turn at a time, and
     * between those turns nothing of it is executing.
     *
     * So the two are kept apart: the hold below stands from the moment the loop says so until the
     * work is over, and only becomes a run while that loop is running. Said once and it survives
     * the turns after it, and the eviction of the loop with them -- the id it is filed under is the
     * same id the loop is rebuilt as.
     */
    private static byHand: Map<string, Omit<RunningTask, 'runId'>> = new Map();

    /** The run each held task is up as, while the loop holding it is running. */
    private static handRuns: Map<string, string> = new Map();

    /** The handle to hand back on the way out, so two runs of one task cannot retire each other. */
    public static start(task: Omit<RunningTask, 'runId'>): string {
        const runId = randomUUID();
        this.runs.set(runId, {...task, runId});
        return runId;
    }

    public static finish(runId: string): void {
        this.runs.delete(runId);
    }

    /**
     * A loop taking a task on itself, which it can only say from inside a turn of its own: the run
     * of it begins here as well. One task at a time -- the last word is the one that stands.
     */
    public static takeByHand(loopId: string, task: Omit<RunningTask, 'runId'>): void {
        this.endRun(loopId);
        this.byHand.set(loopId, task);
        this.handRuns.set(loopId, this.start(task));
    }

    /** What that loop is working by hand, whether or not any of it is running at this moment. */
    public static takenByHand(loopId: string): Omit<RunningTask, 'runId'> | undefined {
        return this.byHand.get(loopId);
    }

    /** A turn of that loop beginning, which is what makes what it holds a run again. */
    public static resumeByHand(loopId: string): void {
        const task = this.byHand.get(loopId);
        if (!task || this.handRuns.has(loopId)) {
            return;
        }
        this.handRuns.set(loopId, this.start(task));
    }

    /** A turn ending. Nothing of that loop runs until the next one, but the work is still its own. */
    public static pauseByHand(loopId: string): void {
        this.endRun(loopId);
    }

    /** The work being over, or handed to somebody after all. */
    public static dropByHand(loopId: string): void {
        this.endRun(loopId);
        this.byHand.delete(loopId);
    }

    private static endRun(loopId: string): void {
        const runId = this.handRuns.get(loopId);
        if (runId) {
            this.finish(runId);
            this.handRuns.delete(loopId);
        }
    }

    /** Whether anybody is on that task right now, which is what makes handing it out again a waste. */
    public static isRunning(projectId: string, taskId: string): boolean {
        return this.getRunningTasks()
            .some(run => run.projectId === projectId && run.taskId === taskId);
    }

    public static getRunningTasks(): RunningTask[] {
        return [...this.runs.values()];
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

/**
 * A turn of a loop beginning, which is what turns the work it holds into a run again: it said once
 * that the task is its own and the hold has stood since, but what a run is is what is executing,
 * so the card spins for the answer being written and rests while the user reads it.
 *
 * The board is asked whether the work is still there to do, since between two turns anything may
 * have closed the task: the run that closed it, the user closing it off the card, a subagent it
 * was handed to after all. One question here rather than a report from each of them, none of those
 * being a place that knows this hold exists.
 *
 * A loop that took nothing on has nothing to say and nothing to fire.
 */
export function resumeHandWork(context: OneLoopContext): void {
    const held = RunningTaskService.takenByHand(context.loopId);
    if (!held) {
        return;
    }
    if (ProjectManager.getTask(held.projectId, held.taskId)?.status === 'ongoing') {
        RunningTaskService.resumeByHand(context.loopId);
    } else {
        RunningTaskService.dropByHand(context.loopId);
    }
    fireRunningTasksEvent(context);
}

/** The turn over. Nothing of that loop is executing until the next one, the work stays its own. */
export function pauseHandWork(context: OneLoopContext): void {
    if (!RunningTaskService.takenByHand(context.loopId)) {
        return;
    }
    RunningTaskService.pauseByHand(context.loopId);
    fireRunningTasksEvent(context);
}
