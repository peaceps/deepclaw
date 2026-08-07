import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { AgentInteractionEvent, AgentInteractionEventPayload } from '@deepclaw/core';
import { i18nInstance, DEFAULT_LANG } from '@deepclaw/i18n';

let rl: readline.Interface | null = null;

export async function handleStringifiedInteractionEvent(event: AgentInteractionEvent): Promise<string> {
    if (!rl) {
        rl = readline.createInterface({ input: stdin, output: stdout });
    }
    try {
        let answer: string = '';
        const question = stringifiedInteractionEvent(event);
        if (event.type === 'readonly') {
            console.log(question);
        } else {
            answer = await rl.question(question);
            answer = await parseStringifiedAnswer(
                event, answer, console.log, handleStringifiedInteractionEvent
            );
        }
        if (event.key === 'lang' && answer !== DEFAULT_LANG) {
            i18nInstance.changeLanguage(answer as string);
        }
        return answer;
    } catch (error) {
        throw error;
    } finally {
        rl?.close();
        rl = null;
    }
}

export function stringifiedInteractionEvent(event: AgentInteractionEventPayload): string {
    let question = '';
    const content = i18nInstance.t(event.content || '', event.i18nParam) as string;
    if (event.type === 'input') {
        question = content + ' ';
    } else if (event.type === 'select') {
        question = content + '\n';
        const options = event.options!.map((option) => i18nInstance.t(typeof option === 'string' ? option : option.label));
        question += options.map((option, i) => `[${i + 1}] ${option}`).join('\n') + '\n';
        question += i18nInstance.t('im.selectOption');
    } else if (event.type === 'readonly') {
        question = content;
    }
    return question;
}

export async function parseStringifiedAnswer(
    event: AgentInteractionEvent,
    answer: string,
    notify: (message: string) => void,
    callSelf: (event: AgentInteractionEvent) => Promise<string>
): Promise<string> {
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
