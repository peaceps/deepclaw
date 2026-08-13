import { randomUUID } from 'node:crypto';
import { type RunningTask } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';

/**
 * The tasks subagents are working on at this very moment. Nothing of this outlives the process,
 * which is the point: a run that died with it is not running anymore, and the status a task carries
 * cannot tell that apart on its own.
 */
class RunningTaskServiceImpl {

    private static runs: Map<string, RunningTask> = new Map();

    /** The handle to hand back on the way out, so two runs of one task cannot retire each other. */
    public static start(task: Omit<RunningTask, 'runId'>): string {
        const runId = randomUUID();
        this.runs.set(runId, {...task, runId});
        return runId;
    }

    public static finish(runId: string): void {
        this.runs.delete(runId);
    }

    /** Whether a subagent is on that task right now, which is what makes handing it out again a waste. */
    public static isRunning(projectId: string, taskTitle: string): boolean {
        return this.getRunningTasks()
            .some(run => run.projectId === projectId && run.taskTitle === taskTitle);
    }

    public static getRunningTasks(): RunningTask[] {
        return [...this.runs.values()];
    }
}

export const RunningTaskService = globalize('RunningTaskService', RunningTaskServiceImpl);
