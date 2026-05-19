import {ReactElement, useContext} from 'react';
import { Box, Text } from "ink";
import { useWidth } from '../hooks/use-width.js';
import {Dots} from './dots.js';
import {StaticContext} from '../hooks/static-context.js';

export function LlmOutput({
    llmOutput,
    userAction
}: {
    llmOutput: string;
    userAction: boolean;
}): ReactElement {
    const {indent} = useContext(StaticContext);
    const rowWidth = useWidth(indent);
    return (
        <Box marginLeft={indent} width={rowWidth}>
            {!llmOutput && !userAction ? <Dots/> : <Text color="#EDCF53" wrap="hard">{llmOutput}</Text>}
        </Box>
    );
}
