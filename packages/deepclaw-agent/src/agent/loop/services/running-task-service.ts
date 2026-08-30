import { randomUUID } from 'node:crypto';
import { type RunningTask } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';
import { type OneLoopContext } from '../../definitions/definitions';

/**
 * What a caller has to say about a run beginning. The run id comes back from the book it went into,
 * and what kind of run it is is the book it went into, so neither is anybody's to pass in.
 */
export type StartingTask = Omit<RunningTask, 'runId' | 'kind'>;

/**
 * The tasks being worked at this very moment, in three books by who is working them: the task loops
 * they were handed to, the main loops working them themselves, and the readings a reviewer is in
 * the middle of. Nothing of this outlives the process, which is the point: a run that died with it
 * is not running anymore, and the status a task carries cannot tell that apart on its own.
 *
 * Kept in books rather than in one list with a field to sort it by, because every question asked
 * here is about one or two of them and never about "a run": handing a task out asks after subagents,
 * the card spins for work and draws a reading on a line of its own. The field is written all the
 * same, and written from in here, for the browsers, which are handed the three of them as one list
 * and have nothing else to tell the rows apart by.
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

    /**
     * The readings under way, by the run each is going on under. A reading is a spawned run like a
     * task loop, and lasts exactly as long as it, but it is a book of its own because it answers a
     * different question: what a reader is doing is looking at work that already stands, so it is
     * no reason to refuse anything a run on the work itself would be.
     */
    private static reviewRuns: Map<string, RunningTask> = new Map();

    private static isOn(runs: Iterable<RunningTask>, projectId: string, taskId: string): boolean {
        return [...runs].some(run => run.projectId === projectId && run.taskId === taskId);
    }

    /** The handle to hand back on the way out, so two runs of one task cannot retire each other. */
    public static startTaskLoopRun(task: StartingTask): string {
        const runId = randomUUID();
        this.taskLoopRuns.set(runId, {...task, runId, kind: 'work'});
        return runId;
    }

    public static finishTaskLoopRun(runId: string): void {
        this.taskLoopRuns.delete(runId);
    }

    /** A task going out to be read over, which is a run of its own beside whatever else is on it. */
    public static startReviewRun(task: StartingTask): string {
        const runId = randomUUID();
        this.reviewRuns.set(runId, {...task, runId, kind: 'review'});
        return runId;
    }

    public static finishReviewRun(runId: string): void {
        this.reviewRuns.delete(runId);
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
    public static startMainLoopRun(loopId: string, task: StartingTask): void {
        this.mainLoopRuns.set(loopId, {...task, runId: loopId, kind: 'work'});
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

    /**
     * Whether anybody is working that task right now, which is the whole of what the card spins for.
     *
     * A reading is not working it. It is a run on the task and it draws a row of its own, but what
     * this question stands in front of is work being taken over or closed out from under somebody,
     * and a reader is doing neither: it reads what already stands there. Asked for by name below
     * where somebody means to ask about one.
     */
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

    /** Whether the task is being read over at this moment, which no second reading joins. */
    public static isReviewRunning(projectId: string, taskId: string): boolean {
        return this.isOn(this.reviewRuns.values(), projectId, taskId);
    }

    public static getRunningTasks(): RunningTask[] {
        return [
            ...this.taskLoopRuns.values(), ...this.mainLoopRuns.values(), ...this.reviewRuns.values(),
        ];
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
