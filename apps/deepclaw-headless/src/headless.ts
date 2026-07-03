import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { cleanupOnShutdown } from '@deepclaw/node-utils';
import { validateAndFixCurrentConfig } from '@deepclaw/config';
import { DEFAULT_LANG } from '@deepclaw/i18n';
import { connectIM, stringifiedInteractionEvent, parseStringifiedAnswer } from '@deepclaw/im';
import { AgentInteractionEventPayload } from '@deepclaw/core';
import {i18nInstance} from '@deepclaw/i18n';

let rl: readline.Interface | null = null;

async function handleInteractionEvent(event: AgentInteractionEventPayload): Promise<string> {
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
            answer = await parseStringifiedAnswer(event, answer, console.log, handleInteractionEvent);
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

validateAndFixCurrentConfig(handleInteractionEvent, true).then(() => {
    const {disconnect} = connectIM();
    cleanupOnShutdown(disconnect);
}).catch(error => {
    // TODO handle error
    console.error(error);
    process.exit(1);
});
