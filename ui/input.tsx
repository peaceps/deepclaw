import {ReactElement} from 'react';
import {Box, Text} from 'ink';

export default function Input({
	userInput,
	indent = 2,
}: {
	userInput: string;
	indent?: number;
}): ReactElement {
	// 列布局下子项默认 stretch 会占满整行宽度，IME 预编辑会跟「行尾」跑到屏幕最右侧。
	return (
		<Box marginLeft={indent} alignSelf="flex-start">
			<Text color="cyan">&gt;&gt;&gt; </Text>
			<Text color={userInput ? 'cyan' : 'gray'}>
				{userInput || '(等待输入...)'}
			</Text>
		</Box>
	);
}
