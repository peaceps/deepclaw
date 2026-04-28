import {ReactElement, useContext} from 'react';
import {Box, Text} from 'ink';
import Banner from './banner.js';
import {useWidth} from './hooks/use-width.js';
import {StaticContext} from './hooks/static-context.js';

export type HistoryItem = {
	role: 'user' | 'assistant' | 'banner';
	content?: string;
};

export function HistoryLine({
	item,
}: {
	item: HistoryItem;
}): ReactElement {
	const {indent, prompt} = useContext(StaticContext);
	const rowWidth = useWidth(indent);
	return (
		<Box marginLeft={indent} width={rowWidth}>
            {item.role === 'banner' ? <Banner /> :
                <Text color={item.role === 'user' ? 'cyan' : 'white'}>{prompt}{item.content}{'\n'}</Text>
            }
		</Box>
	);
}
