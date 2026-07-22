import { FlushAgentRole, type AgentHandler } from '@deepclaw/core';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import { ensureBaseFiles } from '../base-file-initializer';
import { AgentIdentityManager } from './loop/services/agent-identity-manager';
import './loop/hooks/hooks';
import { LoopAgent } from './loop/loop/loop';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';
import { loadAgentConfig } from '@deepclaw/config';
import { detectAgentProtocolFromUrl } from './loop-protocol-detector';
import { LLMProtocol } from './definitions/definitions';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop';

type LoopConstructor = new (
    role: FlushAgentRole,
    agentId: string,
    projectId: string,
    handler: AgentHandler,
) => LoopAgent<any, any, any>;

const loopClassMap: Record<LLMProtocol, LoopConstructor> = {
    OpenAIChat: OpenAIChatLoop,
    OpenAIResponse: OpenAIResponseLoop,
    Anthropic: AnthropicLoop,
};

export class LoopInitializer {
    static {
        ensureBaseFiles();
    }

    public static getLoop(role: FlushAgentRole, agentId: string, projectId: string, handler: AgentHandler): LoopAgent<any, any, any> {
        const identity = AgentIdentityManager.getAgent(agentId);
        if (!identity) {
            throw new Error(`Agent "${agentId}" not found`);
        }
        const config = loadAgentConfig(agentId);
        const protocol = detectAgentProtocolFromUrl(config.llm.baseURL);
        if (!protocol) {
            throw new Error(`Invalid agent baseURL: ${config.llm.baseURL}`);
        }
        return new (loopClassMap[protocol])(role, agentId, projectId, handler);
    }
}
