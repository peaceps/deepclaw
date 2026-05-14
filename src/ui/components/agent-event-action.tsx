import {ReactElement, useContext} from 'react';
import {Box, Text} from 'ink';
import { useWidth } from '../hooks/use-width.js';
import {StaticContext} from '../hooks/static-context.js';

export function AgentEventAction({
	userInput,
}: {
	userInput: string;
}): ReactElement {
    const {indent, prompt} = useContext(StaticContext);
    const rowWidth = useWidth(indent);
	return (
		<Box marginLeft={indent} alignSelf="flex-start" width={rowWidth}>
			<Text wrap="hard">
				<Text color="cyan">{prompt}</Text>
				<Text color={userInput ? 'cyan' : 'gray'}>
					{userInput || '等待输入...\n'}
				</Text>
			</Text>
		</Box>
	);
}
