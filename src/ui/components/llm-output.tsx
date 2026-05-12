import {ReactElement, useContext} from 'react';
import { Box, Text } from "ink";
import { useWidth } from '../hooks/use-width.js';
import Dots from './dots.js';
import {StaticContext} from '../hooks/static-context.js';

export function LlmOutput({
    llmOutput,
}: {
    llmOutput: string;
}): ReactElement {
    const {indent} = useContext(StaticContext);
    const rowWidth = useWidth(indent);
    return (
        <Box marginLeft={indent} width={rowWidth}>
            {!llmOutput ? <Dots/> : <Text color="#EDCF53" wrap="hard">{llmOutput}</Text>}
        </Box>
    );
}
