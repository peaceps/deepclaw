export type MissionStatus = 'todo' | 'ongoing' | 'done';

export const PROJECT_CONFIG = {
    maxTagCount: 5,
    maxTagTextLength: 15
} as const;

export type Project = {
    id: string;
    title: string;
    description: string;
    createdAt?: string;
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
    stepsStatus?: TaskStepsContext
};
