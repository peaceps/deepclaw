import { type FlushAgentConstructor } from '@deepclaw/core';
import {hasEnvVariable, getEnvVariable} from '@deepclaw/config';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop.js';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop.js';
import { AnthropicLoop } from './loop/loop/anthropic-loop.js';
import './loop/hooks/hooks.js';

export class LoopInitializer {
    public static getLoopClass(): FlushAgentConstructor {
        if (hasEnvVariable('OPENAI_BASE_URL')) {
            return getEnvVariable('OPENAI_RESPONSE_API').toLowerCase() === 'false' ? OpenAIChatLoop : OpenAIResponseLoop;
        } else if (hasEnvVariable('ANTHROPIC_BASE_URL')) {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }
}
