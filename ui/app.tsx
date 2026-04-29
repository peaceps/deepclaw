import {ReactElement} from 'react';
import {useState, useMemo, useEffect, useRef} from 'react';
import {useInput, Box, Static} from 'ink';
import {LoopAgent} from '../agent/index.js';
import {HistoryLine, type HistoryItem} from './history.js';
import {StaticContext, STATIC_CONTEXT_DEFAULT} from './hooks/static-context.js';
import EveryInput from './every-input.js';
import LlmOutput from './llm-output.js';

const agent = new LoopAgent();

export default function App({app}: {app: {unmount: () => void}}): ReactElement {
    const [histories, setHistories] = useState([] as HistoryItem[]);
    const [llmOutput, setLlmOutput] = useState('');
    const [llmWorking, setLlmWorking] = useState(false);
    const [userInput, setUserInput] = useState('');
    const llmWorkingRef = useRef(llmWorking);
    llmWorkingRef.current = llmWorking;
    const llmOutputRef = useRef(llmOutput);
    llmOutputRef.current = llmOutput;

	const staticRows = useMemo((): HistoryItem[] => {
		return [{role: 'banner'}, ...histories];
	}, [histories]);

	useEffect(() => {
		agent.setStreamHandler((text: string) => {
            if (llmWorkingRef.current) {
		        setLlmOutput(prev => prev + text);
            }
		});
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
                    agent.invoke(userInput).then((msg) => {
                        setHistories(prev => [...prev, {role: 'assistant', content: llmOutputRef.current + msg}]);
                    }).catch(err => {
                        setHistories(prev => [...prev, {role: 'assistant', content: `出错了: ${err.message?.trim() || ''}`}]);
                    }).finally(() => {
                        setLlmOutput('');
                        setLlmWorking(false);
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
                    {(row, index) =>
                        <HistoryLine
                            item={row}
                            key={row.role === 'banner' ? 'banner' : `h-${index}`}
                        />
                    }
                </Static>
                {!llmWorking ? <EveryInput userInput={userInput}/> : <LlmOutput llmOutput={llmOutput}/>}
            </StaticContext>
        </Box>
	);
}
