import { i18nInstance } from '@deepclaw/i18n';

type TaskStepsContext = {
    steps: string[];
    currentStepIndex: number;
}

const MARKERS = {
    pending: '[ ]',
    inProgress: '[>]',
    completed: '[√]',
};

const MAX_TODO_ITEM = 12;

export class TaskStepsManager {
    private static tasks: Record<string, Record<string, TaskStepsContext>> = {};

    public static init(projectId: string, taskTitle: string, steps: string[]): void {
        if (steps.length > MAX_TODO_ITEM) {
            throw new Error(`Keep the session plan short (max ${MAX_TODO_ITEM} items)`);
        }
        if (!this.tasks[projectId]) {
            this.tasks[projectId] = {};
        }
        this.tasks[projectId][taskTitle] = {
            steps,
            currentStepIndex: -1
        };
    }

    public static updateCurrentStep(projectId: string, taskTitle: string, stepIndex: number): string {
        const context = this.tasks[projectId]?.[taskTitle];
        if (!context) {
            throw new Error('No todo found for the specified task.');
        }
        if (stepIndex < 0 || stepIndex > context.steps.length) {
            throw new Error('Invalid step index.');
        }
        if (context.steps.length === 0) {
            return i18nInstance.t('agent.tools.todo.empty');
        }
        context.currentStepIndex = stepIndex;
        return this.getState(context);
     }

    public static isStepsCompleted(projectId: string, taskTitle: string): boolean {
        const context = this.tasks[projectId]?.[taskTitle];
        if (!context || context.steps.length === 0) {
            return true;
        }
        return context.currentStepIndex === context.steps.length;
    }

    private static getState(context: TaskStepsContext): string {
        const currentStep = context.currentStepIndex;
        const lines = context.steps.map((item, i) => {
            const marker = MARKERS[i < currentStep ? 'completed' : (i === currentStep ? 'inProgress' : 'pending')];
            return `${marker} ${item}`;
        });
        lines.push(i18nInstance.t('agent.tools.todo.completed', {completed: currentStep, total: context.steps.length}));
        const steps = lines.join('\n');
        return i18nInstance.t('agent.tools.todo.current', {steps});
    }
}
