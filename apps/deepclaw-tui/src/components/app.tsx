import {useState, useMemo, useEffect, ReactElement, useCallback, useEffectEvent, useRef} from 'react';
import { Box, Static, useApp } from 'ink';
import { AgentInteractionEventConfig, AgentStreamEvent, AgentToolResultEvent } from '@deepclaw/core';
import { DEFAULT_LANG } from '@deepclaw/i18n';
import {LoopGateway} from '@deepclaw/loop-gateway';
import {HistoryLine, type HistoryItem} from './history';
import {StaticContext, STATIC_CONTEXT_DEFAULT} from '../hooks/static-context';
import {UserChat} from './user-chat';
import {LlmOutput} from './llm-output';
import { UserInteraction } from './user-interaction';
import { useConfig } from '../hooks/use-config';
import { useTranslation } from 'react-i18next';
import { formatToolResult } from './tui-formater';

export type AppConfig = {
}

export function App({app}: {app: AppConfig}): ReactElement {
    const {exit} = useApp();
    const agentIdRef = useRef('');
    const [histories, setHistories] = useState([] as HistoryItem[]);
    const [llmOutput, setLlmOutput] = useState('');
    const [llmWorking, setLlmWorking] = useState(false);
    const [agentEvent, setAgentEvent] = useState(null as AgentInteractionEventConfig | null);
    const [agentResolver, setAgentResolver] = useState(null as any);
    const {t, i18n} = useTranslation();

	const staticRows = useMemo((): HistoryItem[] => {
		return [{role: 'banner'}, ...histories];
	}, [histories]);

    const handleLlmDone = useCallback((content: string) => {
        setLlmWorking(false);
        setTimeout(() => {
            setHistories(prev => [...prev, {role: 'assistant', content}]);
            setLlmOutput('');
        }, 0);
    }, []);

    const invokeLlm = useCallback((userInput: string) => {
        setHistories(prev => [...prev, {role: 'user', content: userInput}]);
        setLlmWorking(true);
        LoopGateway.invoke(agentIdRef.current!, '', userInput).catch(err => {
            setTimeout(() => {
                handleLlmDone(`${t('common.error')} ${err.message?.trim() || t('common.unexpected')}`);
            }, 0);
        });
    }, [t, handleLlmDone]);

    const handleAgentEvent = useCallback((event: AgentInteractionEventConfig): Promise<string> => {
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
    }, [i18n]);

    const envConfigReady = useConfig(handleAgentEvent);

    const handleStream = useEffectEvent((e: AgentStreamEvent) => {
        if (e.done) {
            handleLlmDone(llmOutput);
        } else {
            setLlmOutput(prev => prev + e.text);
        }
    });

    const handleToolResult = useEffectEvent((e: AgentToolResultEvent) => {
        const formatedResult = formatToolResult(e, t);
        if (formatedResult) {
            handleStream({eventType: 'stream', text: formatedResult, done: false, loopId: agentIdRef.current});
        } 
    });

	useEffect(() => {
        if (envConfigReady) {
            agentIdRef.current = LoopGateway.getLoopInfo().agents[0]!.id;
            LoopGateway.init(agentIdRef.current, '', {
                onStreamText: handleStream,
                onToolText: handleToolResult,
                onInteractionEvent: handleAgentEvent
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
