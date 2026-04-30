import {ReactElement, useCallback} from 'react';
import {useState, useMemo, useEffect, useRef} from 'react';
import {useInput, Box, Static} from 'ink';
import {LoopAgent, TestLlmAgent, FlushAgent, ALL_CONTENT_FLUSHED} from '../agent/index.js';
import {HistoryLine, type HistoryItem} from './history.js';
import {StaticContext, STATIC_CONTEXT_DEFAULT} from './hooks/static-context.js';
import EveryInput from './every-input.js';
import LlmOutput from './llm-output.js';

export type AppConfig = {
    unmount: () => void;
    testMode: boolean;
}

let agent: FlushAgent | null = null;

export default function App({app}: {app: AppConfig}): ReactElement {
    const [histories, setHistories] = useState([] as HistoryItem[]);
    const [llmOutput, setLlmOutput] = useState('');
    const [llmWorking, setLlmWorking] = useState(false);
    const [userInput, setUserInput] = useState('');
    const llmOutputRef = useRef(llmOutput);
    llmOutputRef.current = llmOutput;

	const staticRows = useMemo((): HistoryItem[] => {
		return [{role: 'banner'}, ...histories];
	}, [histories]);

    const handleLlmDone = useCallback((content: string) => {
        setHistories(prev => [...prev, {role: 'assistant', content}]);
        setLlmOutput('');
        setLlmWorking(false);
    }, []);

	useEffect(() => {
        function handleLlmStream(text: string) {
            if (text === ALL_CONTENT_FLUSHED) {
                handleLlmDone(llmOutputRef.current);
            } else {
                setLlmOutput(prev => prev + text);
            }
        }
        agent = app.testMode ? new TestLlmAgent(handleLlmStream) : new LoopAgent(handleLlmStream);
	}, []);

	useInput((input, key) => {
        if (key.return) {
            if (userInput.trim() !== '') {
                if (userInput.trim().toLowerCase() === 'q' || userInput.trim().toLowerCase() === 'exit') {
                    app.unmount();
                } else {
                    setHistories(prev => [...prev, {role: 'user', content: userInput}]);
                    setUserInput('');
                    setLlmWorking(true);
                    agent!.invoke(userInput).catch(err => {
                        handleLlmDone(`出错了: ${err.message?.trim() || 'Unexpected error.'}`);
                    });
                }
            }
        } else if (key.delete || key.backspace) {
            setUserInput(prev => prev.slice(0, -1));
        } else if (input) {
            setUserInput(prev => prev + input);
        }
    });

	return (
        <Box flexDirection="column">
            <StaticContext value={STATIC_CONTEXT_DEFAULT}>
                <Static items={staticRows}>
                    {
                        (row, index) => <HistoryLine item={row} key={row.role === 'banner' ? 'banner' : `h-${index}`} />
                    }
                </Static>
                {!llmWorking ? <EveryInput userInput={userInput}/> : <LlmOutput llmOutput={llmOutput}/>}
            </StaticContext>
        </Box>
	);
}
