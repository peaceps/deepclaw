import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { LoopInitializer } from '@deepclaw/agent';
import { cleanupOnShutdown } from '@deepclaw/utils';
import { validateAndFixConfig, DEFAULT_LANG } from '@deepclaw/config';
import { connectIM, stringifiedInteractionEvent, parseStringifiedAnswer } from '@deepclaw/im';
import { AgentInteractionEvent } from '@deepclaw/core';
import {i18nInstance} from '@deepclaw/i18n';

let rl: readline.Interface | null = null;

async function handleInteractionEvent(event: AgentInteractionEvent): Promise<string> {
    if (!rl) {
        rl = readline.createInterface({ input: stdin, output: stdout });
    }
    try {
        let answer = '';
        const question = stringifiedInteractionEvent(event);
        if (event.type === 'readonly') {
            console.log(question);
        } else {
            answer = await rl.question(question);
            answer = await parseStringifiedAnswer(event, answer, console.log, handleInteractionEvent);
        }
        if (event.key === 'lang' && answer !== DEFAULT_LANG) {
            i18nInstance.changeLanguage(answer);
        }
        return answer;
    } catch (error) {
        throw error;
    } finally {
        rl?.close();
        rl = null;
    }
}

validateAndFixConfig(handleInteractionEvent, true).then(() => {
    const {disconnect} = connectIM(LoopInitializer.getLoopClass());
    cleanupOnShutdown(disconnect);
});
