import { ReactElement } from 'react';
import { Box} from 'ink';
import {TextInput} from './input/text-input';
import { AgentEvent } from '@core';

export function UserInteraction({
    event,
    onEnter
}: {
    event: AgentEvent,
    onEnter: (input: string) => void
}): ReactElement {
    return (
        <Box>
            {event.type === 'ask' && <TextInput
                onEnter={onEnter}
                customPrompt={event.content}
                color="#E9A02D"
            />}
        </Box>
    );
}
