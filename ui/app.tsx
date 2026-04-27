import process from 'node:process';
import React from 'react';
import {useState, useRef, useMemo, useLayoutEffect} from 'react';
import cliCursor from 'cli-cursor';
import {useInput, Box, Static} from 'ink';
import {LoopAgent} from '../agent/index.js';
import {HistoryLine, type HistoryItem} from './history.js';
import Input from './input.js';
import LlmOutput from './llm-output.js';
import Dots from './dots.js';

const agent = new LoopAgent();

export default function App({app}: {app: {unmount: () => void}}): JSX.Element {
    const [histories, setHistories] = useState([] as HistoryItem[]);
    const [llmOutput, setLlmOutput] = useState('');
    const [llmWorking, setLlmWorking] = useState(false);
    const [userInput, setUserInput] = useState('');
    const [isSubmitted, setIsSubmitted] = useState(false);

	const llmOutputRef = useRef(llmOutput);
	llmOutputRef.current = llmOutput;

	const staticRows = useMemo((): HistoryItem[] => {
		return [{role: 'banner'}, ...histories];
	}, [histories]);

	// Ink 默认隐藏光标；隐藏时 Windows 等终端上 IME 预编辑常会锚到屏幕边缘。
	useLayoutEffect(() => {
		cliCursor.show(process.stderr);
	}, [userInput, llmOutput, llmWorking, histories]);

	agent.setStreamHandler((text: string) => {
		setLlmOutput(prev => prev + text);
	});

	useInput((input, key) => {
        if (key.return) {
            if (userInput.trim() !== '') {
                setIsSubmitted(true);
                setHistories(prev => [...prev, {role: 'user', content: userInput}]);
                setUserInput('');
                if (userInput.trim().toLowerCase() === 'q' || userInput.trim().toLowerCase() === 'exit') {
                    app.unmount();
                } else {
                    setLlmWorking(true);
                    agent.invoke(userInput).catch(err => {
                        setLlmOutput(`发生错误: ${err.message}`);
                    }).finally(() => {
                        setHistories(prev => [...prev, {role: 'assistant', content: llmOutputRef.current}]);
                        setLlmOutput('');
                        setLlmWorking(false);
                    });
                }
            }
        } else if (key.delete || key.backspace) {
            setUserInput(prev => prev.slice(0, -1));
        } else if (input) {
            setUserInput(prev => prev + input);
            if (isSubmitted) setIsSubmitted(false);
        }
    });

	return (
		<Box flexDirection="column" marginTop={1}>
			<Static items={staticRows}>
				{(row, index) =>
                    <Box key={row.role === 'banner' ? 'banner' : `h-${index}`}>
                        <HistoryLine item={row} />
                    </Box>
				}
			</Static>
			{!llmWorking ? <Input userInput={userInput} /> : 
                (!llmOutput ? <Dots /> : <LlmOutput llmOutput={llmOutput} />)
            }
		</Box>
	);
}
