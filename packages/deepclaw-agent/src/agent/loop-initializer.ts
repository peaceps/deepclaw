import { type AgentIdentity, type AgentHandler } from '@deepclaw/core';
import { loadAgentConfig} from '@deepclaw/config';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import { ensureBaseFiles } from '../base-file-initializer';
import { AgentIdentityManager } from './loop/services/agent-identity-manager';
import './loop/hooks/hooks';
import { LoopAgent } from './loop/loop/loop';

type LoopConstructor = new (
    agentIdentity: AgentIdentity,
    handler: AgentHandler
) => LoopAgent<any, any, any>;

export class LoopInitializer {
    static {
        ensureBaseFiles();
    }

    public static getLoop(agentId: string, handler: AgentHandler): LoopAgent<any, any, any> {
        const identity = AgentIdentityManager.getAgent(agentId);
        if (!identity) {
            throw new Error(`Agent "${agentId}" not found`);
        }
        let loopClass = this.getLoopClass(agentId);
        return new loopClass(identity, handler);
    }

    private static getLoopClass(agentId: string): LoopConstructor {
        const llmConfig = loadAgentConfig(agentId).llm;
        if (llmConfig.provider === 'openai') {
            return llmConfig.responseApi ? OpenAIResponseLoop : OpenAIChatLoop;
        } else if (llmConfig.provider === 'anthropic') {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }
}
