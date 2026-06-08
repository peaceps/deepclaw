import { ReactElement } from 'react';
import { Box} from 'ink';
import {TextInput} from './input/text-input';
import {ReadOnlyInput} from './input/readonly-input';
import {SelectInput} from './input/select-input';
import { AgentInteractionEvent } from '@deepclaw/core';
import { type TFunction } from '@deepclaw/i18n';
import { useTranslation } from 'react-i18next';

function translateEvent(t: TFunction<"translation", undefined>, event: AgentInteractionEvent): AgentInteractionEvent {
    const translatedContent = t(event.content);
    if (event.type === 'select') {
        return {
            ...event,
            content: translatedContent,
            options: event.options.map(option => (
                typeof option === 'string'
                    ? t(option)
                    : {...option, label: t(option.label)}
            ))
        };
    }
    return {...event, content: translatedContent};
}

export function UserInteraction({
    event,
    onEnter
}: {
    event: AgentInteractionEvent,
    onEnter: (input: string|boolean|number) => void
}): ReactElement {
    const {t} = useTranslation();
    const translatedEvent = translateEvent(t, event);
    return (
        <Box>
            {translatedEvent.type === 'readonly' && <ReadOnlyInput
                onEnter={onEnter}
                content={translatedEvent.content}
                color="#E9A02D"
            />}
            {translatedEvent.type === 'input' && <TextInput
                onEnter={onEnter}
                customPrompt={translatedEvent.content}
                color="#E9A02D"
            />}
            {translatedEvent.type === 'select' && <SelectInput
                onEnter={onEnter}
                customPrompt={translatedEvent.content}
                options={translatedEvent.options}
                color="#E9A02D"
            />}
        </Box>
    );
}
