import {ReactElement} from 'react';
import { Box, Text } from "ink";
import { useWidth } from './hooks/use-width.js';
import Dots from './dots.js';

export default function LlmOutput({
    llmOutput,
}: {
    llmOutput: string;
}): ReactElement {
    const rowWidth = useWidth();
    return (
        !llmOutput ? <Box><Dots/></Box> :
        <Box width={rowWidth}>
            <Text color="white">{llmOutput}{'\n'}</Text>
        </Box>
    );
}