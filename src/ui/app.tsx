import {useState, useMemo, useEffect, ReactElement, useCallback, useEffectEvent} from 'react';
import { Box, Static, useApp } from 'ink';
import { FlushAgent, type FlushAgentConstructor, AgentEvent } from '@core';
import {HistoryLine, type HistoryItem} from './components/history.js';
import {StaticContext, STATIC_CONTEXT_DEFAULT} from './hooks/static-context.js';
import {UserChat} from './components/user-chat.js';
import {LlmOutput} from './components/llm-output.js';
import { UserInteraction } from './components/user-interaction.js';
import { useConfig } from './hooks/use-config.js';

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
            handleLlmDone(`出错了: ${err.message?.trim() || 'Unexpected error.'}`);
        });
    }, [handleLlmDone]);

    const handleAgentEvent = useCallback((event: AgentEvent): Promise<string> => {
        setAgentEvent(event);
        return new Promise((resolve) => {
            setAgentResolver(() => (choice: string) => {
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
        function handleLlmStreamText(text: string, done: boolean = false) {
            if (done) {
                handleWithLLMoutput();
            } else {
                setLlmOutput(prev => prev + text);
            }
        }
        if (envConfigReady) {
            agent = new (app.getAgentClass())(handleLlmStreamText, handleAgentEvent);
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
                        seed={(histories[histories.length - 1]?.content || '').length}
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
