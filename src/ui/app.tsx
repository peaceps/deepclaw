import {useState, useMemo, useEffect, ReactElement, useCallback, useEffectEvent} from 'react';
import { Box, Static, useApp } from 'ink';
import { FlushAgent, type FlushAgentConstructor, AgentEvent } from '@core';
import i18n from 'i18next';
import '../i18n/i18n';
import {HistoryLine, type HistoryItem} from './components/history.js';
import {StaticContext, STATIC_CONTEXT_DEFAULT} from './hooks/static-context.js';
import {UserChat} from './components/user-chat.js';
import {LlmOutput} from './components/llm-output.js';
import { UserInteraction } from './components/user-interaction.js';
import { useConfig } from './hooks/use-config.js';
import { DEFAULT_LANG } from '@utils';

export type AppConfig = {
    getAgentClass: () => FlushAgentConstructor;
}

let agent: FlushAgent | null = null;

export function App({app}: {app: AppConfig}): ReactElement {
    const {exit} = useApp();
    const [histories, setHistories] = useState([] as HistoryItem[]);
    const [llmOutput, setLlmOutput] = useState('');
    const [llmWorking, setLlmWorking] = useState(false);
    const [agentEvent, setAgentEvent] = useState(null as AgentEvent | null);
    const [agentResolver, setAgentResolver] = useState(null as any);

	const staticRows = useMemo((): HistoryItem[] => {
		return [{role: 'banner'}, ...histories];
	}, [histories]);

    const handleLlmDone = useCallback((content: string) => {
        setHistories(prev => [...prev, {role: 'assistant', content}]);
        setLlmOutput('');
        setLlmWorking(false);
    }, []);

    const invokeLlm = useCallback((userInput: string) => {
        setHistories(prev => [...prev, {role: 'user', content: userInput}]);
        setLlmWorking(true);
        agent!.invoke(userInput).catch(err => {
            handleLlmDone(`${i18n.t('common.error')} ${err.message?.trim() || i18n.t('common.unexpected')}`);
        });
    }, [handleLlmDone]);

    const handleAgentEvent = useCallback((event: AgentEvent): Promise<string> => {
        setAgentEvent(event);
        return new Promise((resolve) => {
            setAgentResolver(() => (choice: string) => {
                if (event.key === 'lang' && choice !== DEFAULT_LANG) {
                    i18n.changeLanguage(choice);
                }
                setAgentEvent(null);
                resolve(choice);
            });
        });
    }, []);

    const envConfigReady = useConfig(handleAgentEvent);

    const handleWithLLMoutput = useEffectEvent(() => {
        handleLlmDone(llmOutput)
    });

	useEffect(() => {
        function handleLlmStreamText(text: string, done: boolean) {
            if (done) {
                handleWithLLMoutput();
            } else {
                setLlmOutput(prev => prev + text);
            }
        }
        if (envConfigReady) {
            agent = new (app.getAgentClass())({
                onText: handleLlmStreamText, 
                onEvent: handleAgentEvent
            });
        }
	}, [app, handleAgentEvent, envConfigReady]);

	return (
        <Box flexDirection="column">
            <StaticContext value={STATIC_CONTEXT_DEFAULT}>
                <Static items={staticRows}>
                    {
                        (row, index) => <HistoryLine
                           item={row}
                           key={row.role === 'banner' ? 'banner' : `h-${index}`}
                        />
                    }
                </Static>
                {envConfigReady && !agentEvent && (!llmWorking ?
                    <UserChat
                        seed={histories.slice().reverse().slice(0, 100).reduce((p, n) => p + (n.content?.length || 0), 0)}
                        onExit={exit}
                        onEnter={invokeLlm}
                    /> :
                    <LlmOutput llmOutput={llmOutput} userAction={!!agentEvent}/>
                )}
                {!!agentEvent && <UserInteraction
                    event={agentEvent}
                    onEnter={agentResolver}
                />}
            </StaticContext>
        </Box>
	);
}
