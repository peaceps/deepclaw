import { type FlushAgentConstructor } from '@core';
import {hasEnvVariable} from '@utils';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop.js';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop.js';
import { AnthropicLoop } from './loop/loop/anthropic-loop.js';

export class LoopInitializer {
    public static getLoopClass(): FlushAgentConstructor {
        if (hasEnvVariable('OPENAI_BASE_URL')) {
            return hasEnvVariable('OPENAI_RESPONSE_API') ? OpenAIResponseLoop : OpenAIChatLoop;
        } else if (hasEnvVariable('ANTHROPIC_BASE_URL')) {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }
}
