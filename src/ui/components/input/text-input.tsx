import {ReactElement, useContext, useState} from 'react';
import {Box, Text, useCursor, useInput} from 'ink';
import stringWidth from 'string-width';
import { useWidth } from '../../hooks/use-width.js';
import {StaticContext} from '../../hooks/static-context.js';

function measureWrappedCursor(text: string, safeWidth: number): {x: number; y: number} {
	let x = 0;
	let y = 0;
	const lines = text.split('\n');

	for (let i = 0; i < lines.length; i++) {
        const fullWidth = stringWidth(lines[i] ?? '');
		y += Math.floor(fullWidth / safeWidth);
		x = fullWidth % safeWidth;
		// Explicit newline moves cursor to next visual line start.
		if (i < lines.length - 1) {
			y += 1;
			x = 0;
		}
	}
	return {x, y};
}

export function TextInput({
    onEnter,
    onExit,
	customPrompt = '',
	placeholder = '',
    color = ''
}: {
    onEnter: (input: string) => void;
    onExit?: () => void;
	customPrompt?: string;
	placeholder?: string;
	color?: string;
}): ReactElement {
    const [userInput, setUserInput] = useState('');

    const {indent, prompt} = useContext(StaticContext);
    const rowWidth = useWidth(indent);

    const {setCursorPosition} = useCursor();
	const fullPrompt = `${prompt}${!customPrompt ? '' : ' ' + customPrompt}`;
    const {x, y} = measureWrappedCursor(fullPrompt + (userInput || ''), rowWidth);
    setCursorPosition({x: x + indent, y: y});

	useInput((input, key) => {
        if (key.return) {
            if (userInput.trim() !== '') {
                if (onExit && (userInput.trim().toLowerCase() === 'q' || userInput.trim().toLowerCase() === 'exit')) {
                    onExit();
                } else {
                    setUserInput('');
                    onEnter(userInput);
                }
            }
        } else if (key.delete || key.backspace) {
            setUserInput(prev => prev.slice(0, -1));
        } else if (input) {
            setUserInput(prev => prev + input);
        }
    });
    
	return (
        // 提示符与输入必须在同一 Text 内嵌套，否则两个 ink-text 单独换行，输出高度与 log-update
        // 擦除行数容易不一致，多行时每敲一字会重复叠印整段。
		<Box marginLeft={indent} alignSelf="flex-start" width={rowWidth}>
			<Text wrap="hard">
				<Text color={color || 'cyan'}>{fullPrompt}</Text>
				<Text color={userInput ? 'cyan' : 'gray'}>
					{userInput || `${placeholder}\n`}
				</Text>
			</Text>
		</Box>
	);
}
