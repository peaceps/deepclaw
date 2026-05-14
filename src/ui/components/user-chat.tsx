import { useState, ReactElement } from 'react';
import { useInput } from 'ink';
import {TextInput} from './input/text-input';

export function UserChat({app, enter}: any): ReactElement {
    const [userInput, setUserInput] = useState('');

	useInput((input, key) => {
        if (key.return) {
            if (userInput.trim() !== '') {
                if (userInput.trim().toLowerCase() === 'q' || userInput.trim().toLowerCase() === 'exit') {
                    app.umount();
                } else {
                    setUserInput('');
                    enter(userInput);
                }
            }
        } else if (key.delete || key.backspace) {
            setUserInput(prev => prev.slice(0, -1));
        } else if (input) {
            setUserInput(prev => prev + input);
        }
    });

    return (
        <TextInput userInput={userInput} placeholder='等待输入...'/>
    );
}
