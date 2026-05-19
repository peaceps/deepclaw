export * from './core/flush-agent.js';

import './i18n/index.js';

import { type FlushAgentConstructor } from './core/flush-agent.js';
import {hasEnvVariable, getEnvVariable} from '@deepclaw/utils';
import { OpenAIChatLoop } from './agent/loop/loop/openai-chat-loop.js';
import { OpenAIResponseLoop } from './agent/loop/loop/openai-response-loop.js';
import { AnthropicLoop } from './agent/loop/loop/anthropic-loop.js';
import './agent/loop/hooks/hooks.js';

export class LoopInitializer {
    public static getLoopClass(): FlushAgentConstructor {
        if (hasEnvVariable('OPENAI_BASE_URL')) {
            return getEnvVariable('OPENAI_RESPONSE_API').toLowerCase() === 'true' ? OpenAIResponseLoop : OpenAIChatLoop;
        } else if (hasEnvVariable('ANTHROPIC_BASE_URL')) {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }
}
