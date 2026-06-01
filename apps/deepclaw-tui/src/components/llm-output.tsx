import {ReactElement, useContext} from 'react';
import { Box, Text } from "ink";
import { useWidth } from '../hooks/use-width';
import {Dots} from './dots';
import {StaticContext} from '../hooks/static-context';

export function LlmOutput({
    llmOutput,
    userAction
}: {
    llmOutput: string;
    userAction: boolean;
}): ReactElement {
    const {indent, prompt} = useContext(StaticContext);
    const rowWidth = useWidth(indent);
    return (
        <Box marginLeft={indent} width={rowWidth}>
            {!llmOutput && !userAction ? <Dots/> : <Text color="#EDCF53" wrap="hard">{prompt} {llmOutput}</Text>}
        </Box>
    );
}
