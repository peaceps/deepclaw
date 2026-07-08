import type { Logger } from '@deepclaw/node-utils';
import { SealedAgentHandler, TransitionReason, type FlushAgent, type AgentRuntime } from '@deepclaw/core';
import { AgentConfig } from '@deepclaw/config';

export type LLMProtocol = 'Anthropic' | 'OpenAIChat' | 'OpenAIResponse';

export type FootPrint = {
    type: string;
    content: string;
}

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    agentId: string;
    projectId: string;
    loopId: string;
    browserId: string;
    sessionDir: string;
    isSubLoop: boolean;
    loopConfig: AgentConfig;
    system: string;
    logger: Logger;
    actions: {
        newSubLoop: (fork?: boolean) => FlushAgent;
        addFootPrint: (footPrint: FootPrint) => void;
        compactIfNeeded: (context: OneLoopContext) => Promise<void>;
        agentHandler: SealedAgentHandler;
        addStringMessage: (message: string) => void;
    },
    runtime: AgentRuntime
}

export type LoopSessionStatus = 'running' | 'paused' | 'ended' | 'error';

export type SessionMetadata = {
    llmProtocol: LLMProtocol;
    agentId: string;
    projectId: string;
    sessionId: string;
    parentSessionId?: string;
    loopId: string;
    isSubLoop: boolean;
    status: LoopSessionStatus;
    transitionReason?: TransitionReason;
    turnCount: number;
    messagesPath: string;
    finalText?: string;
    updatedAt: string;
    endedAt?: string;
}
