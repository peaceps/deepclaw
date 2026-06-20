export type MissionStatus = 'todo' | 'ongoing' | 'done';

export type Project<T extends Task> = {
    id: string;
    title: string;
    description: string;
    createdAt?: string;
    closedAt?: string;
    creator: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    tasks: Record<string, T>;
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
    creator: string; // standalone
    stepsStatus?: TaskStepsContext
    tags?: string[];
};

export type StandaloneTask = Task & {
    createdAt: string; // for standalone tasks
}
