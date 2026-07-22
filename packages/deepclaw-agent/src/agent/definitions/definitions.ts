import type { Logger } from '@deepclaw/node-utils';
import {
    SealedAgentHandler, LLMTransitionReason,
    type AgentRuntime, type TokenUsage,
    FlushAgentRole,
    FlushAgent
} from '@deepclaw/core';
import { AgentConfig } from '@deepclaw/config';

export type LLMProtocol = 'Anthropic' | 'OpenAIChat' | 'OpenAIResponse';

export type FootPrint = {
    type: string;
    content: string;
}

export type SystemPrompt = {
    cacheable: string;
    dynamic: string;
}

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    role: FlushAgentRole;
    agentId: string;
    projectId: string;
    loopId: string;
    browserId: string;
    sessionDir: string;
    isSubLoop: boolean;
    loopConfig: AgentConfig;
    system: SystemPrompt;
    logger: Logger;
    actions: {
        newSubLoop: () => FlushAgent;
        addFootPrint: (footPrint: FootPrint) => void;
        agentHandler: SealedAgentHandler;
        addStringMessage: (message: string) => void;
    },
    runtime: AgentRuntime
}

export type LoopSessionStatus = 'running' | 'paused' | 'idle' | 'error';

export type SessionMetaData = {
    llmProtocol: LLMProtocol;
    agentId: string;
    projectId: string;
    loopId: string;
    isSubLoop: boolean;
    messagesPath: string;
    runtime: {
        status: LoopSessionStatus;
        transitionReason?: LLMTransitionReason;
        turnCount: number;
        finalText?: string;
        updatedAt: string;
        endedAt?: string;
        usage: TokenUsage;
    }
}
