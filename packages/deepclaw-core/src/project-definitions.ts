import type { LLMTaskOutput } from "./flush-agent-types";

export type MissionStatus = 'todo' | 'ongoing' | 'done';
export type MissionPriority = 'low' | 'medium' | 'high' | 'urgent';

export const PROJECT_CONFIG = {
    maxTagCount: 5,
    maxTagTextLength: 15,
    maxTasksCount: 20,
    maxTaskStepsCount: 8,
    /** Read by the tool schemas and by the boxes the user rewrites a task in, so both cut at once. */
    maxTaskTitleLength: 50,
    maxTaskDescriptionLength: 100,
} as const;

export type Project = {
    id: string;
    title: string;
    description: string;
    createdAt: string;
    closedAt?: string;
    /**
     * When the user put the project away, which is a different thing from when it closed. Closing is
     * what the work did -- the last task went done and the project said so of itself -- and a closed
     * project is still on the board, still in the list an agent reads, still something to pick up.
     * This is the user saying they are done with it.
     *
     * Never read this to ask whether a project was put away. Where the folder lies is what answers
     * that, and a project that can be reached at all is one lying among the live ones: the manager
     * drops this field off anything it loads, so every project handed out from there has none. What
     * it is for is the two moments the answer is being given -- the record that lands in the archive
     * folder carries the date, and the update sent to the browsers carries it as the word to take the
     * row off the board -- and outside of those two it is absent by design.
     */
    archivedAt?: string;
    creator: string;
    priority: MissionPriority;
    tags?: string[];
    /**
     * What the whole of the work came to, as opposed to what each task of it produced. The tasks
     * are handed out one by one and read back the same way, so nothing of a project says how it
     * went until someone writes it here.
     */
    output?: LLMTaskOutput;
    /** The tasks under the id each of them is referred to by, which is the id it carries. */
    tasks: Record<string, Task>;
    /** Ids, as everything that points at a task holds one. */
    completedTasks: string[];
    ongoingTasks: string[];
    canStartTasks: string[];
};

export type TaskStepsContext = {
    steps: string[];
    currentStepIndex: number;
}

export type Task = {
    /**
     * What a task is referred to by, everywhere and for as long as it lives. The title is what the
     * user reads and is theirs to change; nothing may hang off it, which is what this is for.
     */
    id: string;
    title: string;
    description: string;
    status: MissionStatus;
    priority: MissionPriority;
    /** Ids of the tasks this one waits for, and of the ones waiting on it. */
    blockedBy: string[];
    blocks: string[];
    assignee?: string;
    closedAt?: string;
    output?: LLMTaskOutput;
    pause?: boolean;
    verified?: boolean;
    stepsStatus?: TaskStepsContext
};

/**
 * A task a subagent is working on right now. The status of a task says it was handed out, not that
 * anything is running: it is set before the handover and stays until the result was accepted.
 */
export type RunningTask = {
    /** The handle of this one run, the only thing telling two runs of a task apart. */
    runId: string;
    projectId: string;
    taskId: string;
    /** Whoever the subagent stands for, the assignee of the task or the agent that spawned it. */
    agentId: string;
    startedAt: string;
};

export function getProjectStatus(project: Project): MissionStatus {
    if (!project.closedAt) {
        return !project.ongoingTasks.length && !project.completedTasks.length ? 'todo' : 'ongoing';
    }
    return 'done';
}

export function getProjectProgress(project?: Project | null): number | null {
    let progress = null;
    if (project) {
        const total = Object.values(project.tasks).length;
        const done = Object.values(project.tasks).filter(task => task.status === 'done').length;
        progress = total > 0 ? Math.round(done / total * 100) : 0;
    }
    return progress;
}

export function getTaskProgress(task: Task): number | null {
    if (task.status !== 'ongoing' || !task.stepsStatus?.steps.length) {
        return null;
    }
    if (task.stepsStatus.currentStepIndex < 0) {
        return 0;
    }
    return Math.round(((task.stepsStatus.currentStepIndex) / task.stepsStatus.steps.length) * 100);
}
