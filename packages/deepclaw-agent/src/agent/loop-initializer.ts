import { FlushAgent, type AgentHandler, type FlushAgentConstructor } from '@deepclaw/core';
import {hasEnvVariable, getEnvVariable} from '@deepclaw/config';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import './loop/hooks/hooks';

export class LoopInitializer {
    public static getLoop(name: string, handler: AgentHandler): FlushAgent {
        let loopClass: FlushAgentConstructor = this.getLoopClass();
        return new loopClass(name, handler);
    }

    private static getLoopClass(): FlushAgentConstructor {
        if (hasEnvVariable('OPENAI_BASE_URL')) {
            return getEnvVariable('OPENAI_RESPONSE_API').toLowerCase() === 'false' ? OpenAIChatLoop : OpenAIResponseLoop;
        } else if (hasEnvVariable('ANTHROPIC_BASE_URL')) {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }
}
