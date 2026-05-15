import {ReactElement, useCallback} from 'react';
import {useState, useMemo, useEffect, useRef} from 'react';
import { Box, Static, useApp } from 'ink';
import { FlushAgent, type FlushAgentConstructor, AgentEvent } from '@core';
import {HistoryLine, type HistoryItem} from './components/history.js';
import {StaticContext, STATIC_CONTEXT_DEFAULT} from './hooks/static-context.js';
import {UserChat} from './components/user-chat.js';
import {LlmOutput} from './components/llm-output.js';
import { UserInteraction } from './components/user-interaction.js';

export type AppConfig = {
    agentClass: FlushAgentConstructor;
}

let agent: FlushAgent | null = null;

export function App({app}: {app: AppConfig}): ReactElement {
    const {exit} = useApp();
    const [histories, setHistories] = useState([] as HistoryItem[]);
    const [llmOutput, setLlmOutput] = useState('');
    const [llmWorking, setLlmWorking] = useState(false);
    const [agentEvent, setAgentEvent] = useState(null as AgentEvent | null);
    const [agentResolver, setAgentResolver] = useState(null as any);
    const llmOutputRef = useRef(llmOutput);

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

    useEffect(() => {
        llmOutputRef.current = llmOutput;
    }, [llmOutput]);

	useEffect(() => {
        function handleLlmStreamText(text: string, done: boolean = false) {
            if (done) {
                handleLlmDone(llmOutputRef.current);
            } else {
                setLlmOutput(prev => prev + text);
            }
        }
        function handleAgentEvent(event: AgentEvent): Promise<string> {
            setAgentEvent(event);
            return new Promise(resolve => {
                setAgentResolver(() => (choice: string) => {
                    setAgentEvent(null);
                    resolve(choice);
                });
            });
        }
        agent = new app.agentClass(handleLlmStreamText, handleAgentEvent);
	}, [app.agentClass, handleLlmDone]);

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
                {!llmWorking ?
                    <UserChat
                        seed={(histories[histories.length - 1]?.content || '').length}
                        onExit={exit}
                        onEnter={invokeLlm}
                    /> :
                    <LlmOutput llmOutput={llmOutput} userAction={!!agentEvent}/>
                }
                {llmWorking && !!agentEvent && <UserInteraction
                    event={agentEvent}
                    onEnter={agentResolver}
                />}
            </StaticContext>
        </Box>
	);
}
