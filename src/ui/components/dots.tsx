import { useState, useEffect, ReactElement } from 'react';
import { Box, Text } from 'ink';

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export default function Dots(): ReactElement {
    const [dot, setDot] = useState(0);
    useEffect(() => {
        const interval = setInterval(() => {
            setDot((dot + 1) % DOTS.length);
        }, 100);
        return () => clearInterval(interval);
    }, [dot]);
    return (
        <Box><Text color="#E5E7EB">{DOTS[dot]}</Text></Box>
    );
}
