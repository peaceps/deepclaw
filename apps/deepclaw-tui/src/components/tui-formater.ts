import { TaskStepsContext } from "@deepclaw/core";
import { type TFunction } from '@deepclaw/i18n';

const MARKERS = {
    pending: '[ ]',
    inProgress: '[>]',
    completed: '[√]',
};

export function handleTaggedStream(tag: string, text: string, t: TFunction<"translation", undefined>): string {
    if (tag === 'update_task_current_step') {
        try {
            const data = JSON.parse(text) as TaskStepsContext;
            return getTaskSteps(data, t);
        } catch {
            return '';
        }
    }
    console.warn(`Unknown tag: ${tag}`);
    return '';
}

function getTaskSteps(context: TaskStepsContext, t: TFunction<"translation", undefined>): string {
    const currentStep = context.currentStepIndex;
    const lines = context.steps.map((item, i) => {
        const marker = MARKERS[i < currentStep ? 'completed' : (i === currentStep ? 'inProgress' : 'pending')];
        return `${marker} ${item}`;
    });
    lines.push(t('tui.tools.updateTaskSteps.completed', {completed: currentStep, total: context.steps.length}));
    const steps = lines.join('\n');
    return t('tui.tools.updateTaskSteps.current', {steps});
}
