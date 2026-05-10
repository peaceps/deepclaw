import { FlushAgent } from './flush-agent.js';
import { TestLlmAgent } from './test-llm-agent.js';
import { OpenAIChatLoop } from './loop/openai-chat-loop.js';
import { OpenAIResponseLoop } from './loop/openai-response-loop.js';
import { AnthropicLoop } from './loop/anthropic-loop';

export { FlushAgent, ALL_CONTENT_FLUSHED } from './flush-agent.js';

export class LoopInitializer {

    public static getLoop(onStreamEvent: (text: string) => void): FlushAgent {
        if ('OPENAI_BASE_URL' in process.env) {
            return 'OPEN_RESPONSE_API' in process.env ? new OpenAIResponseLoop(onStreamEvent) : new OpenAIChatLoop(onStreamEvent);
        } else if ('ANTHROPIC_BASE_URL' in process.env) {
            return new AnthropicLoop(onStreamEvent);
        } else {
            throw new Error('Invalid LLM model');
        }
    }

    public static getTestLoop(onStreamEvent: (text: string) => void): FlushAgent {
        return new TestLlmAgent(onStreamEvent);
    }
}