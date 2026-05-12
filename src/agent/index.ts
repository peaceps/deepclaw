import { type FlushAgentConstructor } from '@core';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop.js';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop.js';
import { AnthropicLoop } from './loop/loop/anthropic-loop.js';

export class LoopInitializer {

    public static getLoopClass(): FlushAgentConstructor {
        if ('OPENAI_BASE_URL' in process.env) {
            return 'OPEN_RESPONSE_API' in process.env ? OpenAIResponseLoop : OpenAIChatLoop;
        } else if ('ANTHROPIC_BASE_URL' in process.env) {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }
}