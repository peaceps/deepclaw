import { type AgentIdentity, type AgentHandler } from '@deepclaw/core';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import { ensureBaseFiles } from '../base-file-initializer';
import { AgentIdentityManager } from './loop/services/agent-identity-manager';
import './loop/hooks/hooks';
import { LoopAgent } from './loop/loop/loop';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';
import { loadAgentConfig } from '@deepclaw/config';
import { detectAgentProtocolFromUrl, type LoopProtocol } from './loop-protocol-detector';

type LoopConstructor = new (
    agentIdentity: AgentIdentity,
    handler: AgentHandler
) => LoopAgent<any, any, any>;



const loopClassMap: Record<LoopProtocol, LoopConstructor> = {
    openai: OpenAIChatLoop,
    anthropic: AnthropicLoop,
};

export class LoopInitializer {
    static {
        ensureBaseFiles();
    }

    public static getLoop(agentId: string, handler: AgentHandler): LoopAgent<any, any, any> {
        const identity = AgentIdentityManager.getAgent(agentId);
        if (!identity) {
            throw new Error(`Agent "${agentId}" not found`);
        }
        const config = loadAgentConfig(agentId);
        const protocol = detectAgentProtocolFromUrl(config.llm.baseURL);
        if (!protocol) {
            throw new Error(`Invalid agent baseURL: ${config.llm.baseURL}`);
        }
        return new (loopClassMap[protocol])(identity, handler);
    }
}
