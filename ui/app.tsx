import React from 'react';
import {useState, useCallback, useRef} from 'react';
import {Text, useInput, useApp, Box} from 'ink';
import {LoopAgent} from '@agent';

const agent = new LoopAgent();

export default function App({app}: {app: {unmount: () => void}}): JSX.Element {
    const [history, setHistory] = useState([] as string[]);
    const [llmOutput, setLlmOutput] = useState('');
    const [llmWorking, setLlmWorking] = useState(false);
    // 1. 定义状态，存储用户当前已输入的内容
    const [userInput, setUserInput] = useState('');
    // 2. 定义状态，控制是否显示"提交成功"的提示
    const [isSubmitted, setIsSubmitted] = useState(false);

    // 使用 useRef 来跟踪最新的 llmOutput
    const llmOutputRef = useRef(llmOutput);
    llmOutputRef.current = llmOutput;

	agent.setStreamHandler((text: string) => {
		setLlmOutput(prev => prev + text);
	});

	useInput((input, key) => {
        // 4. 按回车键 (Enter) 提交输入
        if (key.return) {
            // 仅当有实际输入内容时才触发提交
            if (userInput.trim() !== '') {
                setIsSubmitted(true);
                setHistory(prev => [...prev, userInput]);
                setUserInput('');
				setLlmWorking(true);
				agent.invoke(userInput).then(() => {
				}).catch(err => {
					setLlmOutput(`发生错误: ${err.message}`);
				}).finally(() => {
					setHistory(prev => [...prev, `【LLM回复】${llmOutputRef.current} ✅`]);
					setLlmOutput('');
					setLlmWorking(false);
				});
            }
            return;
        }

        // 5. 按退格键 (Backspace) 删除最后一个字符
        if (key.delete || key.backspace) {
            setUserInput(prev => prev.slice(0, -1));
            return;
        }

		if (input === 'q' || input.toLowerCase() === 'exit') {
			app.unmount();
		}

        // 6. 如果是普通字符输入，追加到状态末尾，并重置提交标志（以便修改后重新提交）
        if (input) {
            setUserInput(prev => prev + input);
            if (isSubmitted) setIsSubmitted(false);
        }
    });

    return (
        <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">✨ 请输入你想说的话，按 <Text color="cyan">Enter</Text> 提交：</Text>
			{history.map((item, index) => (
				<Box key={index} marginLeft={2}>
					<Text color="white">{item}</Text>
				</Box>
			))}
            {!llmWorking && <Box marginLeft={1}>
                <Text color="gray">&gt;&gt;&gt; </Text>
                <Text color="green">{userInput}</Text>
                {/* 如果输入为空但显示了提交状态，给予提示 */}
                {!userInput && <Text color="gray"> (请输入内容，按回车提交)</Text>}
            </Box>}
			{
				llmWorking && <Box marginLeft={1} marginTop={1}>
					<Text color="cyan">{llmOutput}</Text>
				</Box>
			}
        </Box>
    );
}
