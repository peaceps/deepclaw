import { AgentToolResultEvent, TaskStepsContext } from "@deepclaw/core";
import { type TFunction } from '@deepclaw/i18n';

const MARKERS = {
    pending: '[ ]',
    inProgress: '[>]',
    completed: '[√]',
};

export function formatToolResult(e: AgentToolResultEvent, t: TFunction<"translation", undefined>): string {
    if (e.toolName === 'update_task_current_step') {
        return getTaskSteps(e.data, t);
    }
    return '';
}

function getTaskSteps(context: TaskStepsContext, t: TFunction<"translation", undefined>): string {
    const currentStep = context.currentStepIndex;
    const lines = context.steps.map((item, i) => {
        const marker = MARKERS[i < currentStep ? 'completed' : (i === currentStep ? 'inProgress' : 'pending')];
        return `${marker} ${item}`;
    });
    lines.push(t('tools.updateTaskSteps.completed', {completed: currentStep, total: context.steps.length}));
    const steps = lines.join('\n');
    return t('tools.updateTaskSteps.current', {steps});
}
