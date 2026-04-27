import {ReactElement} from 'react';
import {Box, Text} from 'ink';
import Banner from './banner.js';

export type HistoryItem = {
	role: 'user' | 'assistant' | 'banner';
	content?: string;
};

export function HistoryLine({
	item,
	indent = 2,
}: {
	item: HistoryItem;
	indent?: number;
}): ReactElement {
	return (
		<Box marginLeft={indent}>
            {item.role === 'banner' ? <Banner /> :
                <Text color={item.role === 'user' ? 'cyan' : 'white'}>&gt;&gt;&gt; {item.content}</Text>
            }
		</Box>
	);
}
