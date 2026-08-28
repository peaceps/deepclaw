import { FlushAgentRole, type AgentHandler } from '@deepclaw/core';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import { ensureBaseFiles } from '../base-file-initializer';
import { AgentIdentityManager } from './loop/services/agent-identity-manager';
import './loop/hooks/hooks';
import { LoopAgent } from './loop/loop/loop';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';
import { loadAgentConfig } from '@deepclaw/config';
import { detectAgentProtocolFromUrl } from './loop-protocol-detector';
import { CarriedLoopState, LLMProtocol, SpawnedLoop } from './definitions/definitions';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop';

type LoopConstructor = new (
    role: FlushAgentRole,
    agentId: string,
    projectId: string,
    handler: AgentHandler,
    spawned?: SpawnedLoop,
    carried?: CarriedLoopState,
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

    /**
     * `carried` is only ever what a loop dropped for memory left behind, never a lookup of this
     * one's own: see `CarriedLoopState`. A main loop is what is built here, so `spawned` stays unset.
     */
    public static getLoop(
        role: FlushAgentRole, agentId: string, projectId: string, handler: AgentHandler,
        carried?: CarriedLoopState
    ): LoopAgent<any, any, any> {
        const identity = AgentIdentityManager.getAgent(agentId);
        if (!identity) {
            throw new Error(`Agent "${agentId}" not found`);
        }
        const config = loadAgentConfig(agentId);
        const protocol = detectAgentProtocolFromUrl(config.llm.baseURL);
        if (!protocol) {
            throw new Error(`Invalid agent baseURL: ${config.llm.baseURL}`);
        }
        return new (loopClassMap[protocol])(role, agentId, projectId, handler, undefined, carried);
    }
}
