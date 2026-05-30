import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { LoopInitializer } from '@deepclaw/agent';
import { cleanupOnShutdown } from '@deepclaw/utils';
import { validateAndFixConfig, DEFAULT_LANG } from '@deepclaw/config';
import { connectIM } from '@deepclaw/im';
import { AgentInteractionEvent } from '@deepclaw/core';
import {i18nInstance} from '@deepclaw/i18n'

async function handleInteractionEvent(event: AgentInteractionEvent): Promise<string> {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
        let answer = '';
        if (event.type === 'input') {
            answer = await rl.question(i18nInstance.t(event.content || '') + ' ');
        } else if (event.type === 'select') {
            console.log(i18nInstance.t(event.content || ''));
            const options = event.options!.map((option) => i18nInstance.t(typeof option === 'string' ? option : option.label));
            console.log(options.map((option, i) => `[${i + 1}] ${option}`).join('\n'));
            answer = await rl.question(i18nInstance.t('headless.selectOption'));
            let index = Number(answer) - 1;
            if (isNaN(index) || index < 0 || index >= event.options!.length) {
                index = 0;
            }
            const selected = event.options![index]!;
            answer = typeof selected === 'string' ? selected : selected.value;
        } else if (event.type === 'readonly') {
            console.log(i18nInstance.t(event.content || ''));
        }
        if (event.key === 'lang' && answer !== DEFAULT_LANG) {
            i18nInstance.changeLanguage(answer);
        }
        return answer;
    } catch (error) {
        throw error;
    } finally {
        rl.close();
    }
}

validateAndFixConfig(handleInteractionEvent, true).then(() => {
    const agent = new (LoopInitializer.getLoopClass())({
        onStreamText: () => {},
        onToolText: () => {},
        onInteractionEvent: handleInteractionEvent,
    });

    const {disconnect} = connectIM(agent);

    cleanupOnShutdown(disconnect);
});
