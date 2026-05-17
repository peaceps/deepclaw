import { ReactElement } from 'react';
import { Box} from 'ink';
import {TextInput} from './input/text-input';
import {ReadOnlyInput} from './input/readonly-input';
import {SelectInput} from './input/select-input';
import { AgentEvent } from '@core';
import {TFunction} from 'i18next';
import { useTranslation } from 'react-i18next';

function translateEvent(t: TFunction<"translation", undefined>, event: AgentEvent): void {
    event.content = t(event.content);
    if (event.type === 'select') {
        for (let i = 0; i < event.options.length; i++) {
            const option = event.options[i];
            if (typeof option === 'string') {
                event.options[i] = t(option);
            } else {
                option!.label = t(option!.label);
            }
        }
    }
}

export function UserInteraction({
    event,
    onEnter
}: {
    event: AgentEvent,
    onEnter: (input: string) => void
}): ReactElement {
    const {t} = useTranslation();
    translateEvent(t, event);
    return (
        <Box>
            {event.type === 'readonly' && <ReadOnlyInput
                onEnter={onEnter}
                content={event.content}
                color="#E9A02D"
            />}
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
