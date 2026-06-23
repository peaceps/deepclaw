import { type AgentIdentity, type AgentHandler } from '@deepclaw/core';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import { ensureBaseFiles } from '../base-file-initializer';
import { AgentIdentityManager } from './loop/services/agent-identity-manager';
import './loop/hooks/hooks';
import { LoopAgent } from './loop/loop/loop';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';

type LoopConstructor = new (
    agentIdentity: AgentIdentity,
    handler: AgentHandler
) => LoopAgent<any, any, any>;

export type LoopProtocol = "openai" | "anthropic"

const loopClassMap: Record<LoopProtocol, LoopConstructor> = {
    openai: OpenAIChatLoop,
    anthropic: AnthropicLoop,
};

export class LoopInitializer {
    static {
        ensureBaseFiles();
    }

    public static getLoop(agentId: string, sdk: LoopProtocol | null, handler: AgentHandler): LoopAgent<any, any, any> {
        if (!sdk) {
            throw new Error(`Invalid agent SDK: ${agentId}`);
        }
        const identity = AgentIdentityManager.getAgent(agentId);
        if (!identity) {
            throw new Error(`Agent "${agentId}" not found`);
        }
        return new (loopClassMap[sdk])(identity, handler);
    }
}
