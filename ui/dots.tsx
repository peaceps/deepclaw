import { useState, useEffect, ReactElement } from 'react';
import { Box, Text } from 'ink';

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export default function Dots({indent = 2}: {indent?: number}): ReactElement {
    const [dot, setDot] = useState(0);
    useEffect(() => {
        const interval = setInterval(() => {
            setDot((dot + 1) % DOTS.length);
        }, 100);
        return () => clearInterval(interval);
    }, [dot]);
    return (
        <Box marginLeft={indent}><Text>{DOTS[dot]}</Text></Box>
    );
}