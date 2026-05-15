import { ReactElement } from 'react';
import { Box} from 'ink';
import {TextInput} from './input/text-input';
import {SelectInput} from './input/select-input';
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
            {event.type === 'input' && <TextInput
                onEnter={onEnter}
                customPrompt={event.content}
                color="#E9A02D"
            />}
            {event.type === 'select' && <SelectInput
                onEnter={onEnter}
                customPrompt={event.content}
                options={event.options}
                color="#E9A02D"
            />}
        </Box>
    );
}
