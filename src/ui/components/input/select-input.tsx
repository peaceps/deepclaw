import {Fragment, ReactElement, useContext, useState} from 'react';
import {Box, Newline, Text, useInput} from 'ink';
import { useWidth } from '../../hooks/use-width.js';
import {StaticContext} from '../../hooks/static-context.js';

export function SelectInput({
    onEnter,
	customPrompt,
    options = [],
    color = ''
}: {
    onEnter: (input: string) => void;
	customPrompt: string;
	options: string[];
	color?: string;
}): ReactElement {
    const [userSelection, setUserSelection] = useState(0);

    const {indent, prompt} = useContext(StaticContext);
    const rowWidth = useWidth(indent);

    customPrompt = customPrompt.trim();
    const fullPrompt = `${prompt}${!customPrompt ? '' : ' ' + customPrompt} `;

	useInput((_input, key) => {
        if (key.return) {
            onEnter(options[userSelection] || '');
        } else if (key.upArrow) {
            setUserSelection(userSelection === 0 ? 0 : userSelection - 1);
        } else if (key.downArrow) {
            setUserSelection(userSelection === options.length - 1 ? options.length - 1 : userSelection + 1);
        }
    });
    
	return (
		<Box marginLeft={indent} alignSelf="flex-start" width={rowWidth}>
			<Text wrap="hard">
				<Text color={color || 'cyan'}>{fullPrompt}</Text>
                <Newline />
                {
                    options.map((option, index) => (
                        <Fragment key={index}>
                            <Text color={userSelection === index ? 'cyan' : (color || 'gray')}>
                                {index === userSelection ? '>' : ' '} {option}
                            </Text>
                            {index !== options.length - 1 && <Newline />}
                        </Fragment>
                    ))
                }
			</Text>
		</Box>
	);
}
