export type AgentInterface = {
    invoke: (input: string) => Promise<string>;
    setStreamHandler: (onStreamEvent: (text: string) => void) => void;
}

export { LoopAgent } from './loop/loop.js';
export { TestLlmAgent } from './test-llm-agent.js';