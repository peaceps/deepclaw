import {ReactElement, useContext} from 'react';
import { Box, Text } from "ink";
import { useWidth } from './hooks/use-width.js';
import Dots from './dots.js';
import {StaticContext} from './hooks/static-context.js';

export default function LlmOutput({
    llmOutput,
}: {
    llmOutput: string;
}): ReactElement {
    const {indent} = useContext(StaticContext);
    const rowWidth = useWidth(indent);
    return (
        !llmOutput ? <Box marginLeft={indent}><Dots/></Box> :
        <Box marginLeft={indent} width={rowWidth}>
            <Text color="white" wrap="hard">{llmOutput}</Text>
        </Box>
    );
}