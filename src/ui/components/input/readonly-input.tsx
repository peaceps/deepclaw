import {ReactElement, useContext, } from 'react';
import {Box, Text, useInput} from 'ink';
import { useWidth } from '../../hooks/use-width.js';
import {StaticContext} from '../../hooks/static-context.js';

export function ReadOnlyInput({
    onEnter,
	content = '',
    color = ''
}: {
    onEnter: (input: string) => void;
	content: string;
	color?: string;
}): ReactElement {
    const {indent, prompt} = useContext(StaticContext);
    const rowWidth = useWidth(indent);
    content = content.trim();
	const fullContent = `${prompt}${!content ? '' : ' ' + content}`;

	useInput((_input, key) => {
        if (key.return) {
            onEnter('');
        }
    });

	return (
		<Box marginLeft={indent} alignSelf="flex-start" width={rowWidth}>
			<Text wrap="hard">
				<Text color={color || 'cyan'}>{fullContent}</Text>
			</Text>
		</Box>
	);
}
