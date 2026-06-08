import { AgentInteractionEvent } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';

export function stringifiedInteractionEvent(event: AgentInteractionEvent): string {
    let question = '';
    const content = i18nInstance.t(event.content || '', event.i18nParam) as string;
    if (event.type === 'input') {
        question = content + ' ';
    } else if (event.type === 'select') {
        question = content + '\n';
        const options = event.options!.map((option) => i18nInstance.t(typeof option === 'string' ? option : option.label));
        question += options.map((option, i) => `[${i + 1}] ${option}`).join('\n') + '\n';
        question += i18nInstance.t('headless.selectOption');
    } else if (event.type === 'readonly') {
        question = content;
    }
    return question;
}

export async function parseStringifiedAnswer(
    event: AgentInteractionEvent,
    answer: string|boolean|number,
    notify: (message: string) => void,
    callSelf: (event: AgentInteractionEvent) => Promise<string|boolean|number>
): Promise<string|boolean|number> {
    if (event.type !== 'select') {
        return answer;
    }
    let index = Number(answer) - 1;
    if (isNaN(index) || index < 0 || index >= event.options!.length) {
        notify(i18nInstance.t('im.invalidSelection'));
        answer = await callSelf(event);
    } else {
        const selected = event.options![index]!;
        answer = typeof selected === 'string' ? selected : selected.value;
    }
    return answer;
}