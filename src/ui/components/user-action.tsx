import { useState, ReactElement } from 'react';
import { useInput, Box} from 'ink';
import {TextInput} from './input/text-input';
import { AgentEvent } from '@core';

export function UserAction({event, enter}: {event: AgentEvent, enter: (input: string) => void}): ReactElement {
    const [userInput, setUserInput] = useState('');

	useInput((input, key) => {
        if (key.return) {
            setUserInput('');
            enter(userInput);
        } else if (key.delete || key.backspace) {
            setUserInput(prev => prev.slice(0, -1));
        } else if (input) {
            setUserInput(prev => prev + input);
        }
    });

    return (
        <Box>
            {event.type === 'ask' && <TextInput userInput={userInput} customPrompt={event.content} placeholder=''/>}
        </Box>
    );
}
