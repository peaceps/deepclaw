export type MissionStatus = 'todo' | 'ongoing' | 'done';

export const PROJECT_CONFIG = {
    maxTagCount: 5,
    maxTagTextLength: 15,
    maxTasksCount: 20,
    maxTaskStepsCount: 8,
} as const;

export type Project = {
    id: string;
    title: string;
    description: string;
    createdAt: string;
    closedAt?: string;
    creator: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    tags?: string[];
    tasks: Record<string, Task>;
    completedTasks: string[];
    ongoingTasks: string[];
    canStartTasks: string[];
};

export type TaskStepsContext = {
    steps: string[];
    currentStepIndex: number;
}

export type Task = {
    title: string;
    description: string;
    status: MissionStatus;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    blockedBy: string[];
    blocks: string[];
    assignee?: string;
    closedAt?: string;
    output?: {
        type: 'markdown' | 'text' | 'binary';
        content: string;
        path?: string;
    };
    pause?: boolean;
    stepsStatus?: TaskStepsContext
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
