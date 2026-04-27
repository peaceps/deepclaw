import {ReactElement} from 'react';
import { Box, Text } from "ink";

export default function LlmOutput({llmOutput, indent = 2}: {llmOutput: string; indent?: number}): ReactElement {
    return (
        <Box marginLeft={indent} marginTop={1}>
            <Text color="white">{llmOutput}</Text>
        </Box>
    );
}