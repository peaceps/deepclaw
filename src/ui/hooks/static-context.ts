import { createContext } from 'react';

type StaticContextType = {
    indent: number;
    prompt: string;
};

export const STATIC_CONTEXT_DEFAULT: StaticContextType = {
    indent: 2, prompt: '>>> '
};

export const StaticContext = createContext<StaticContextType>(STATIC_CONTEXT_DEFAULT);
