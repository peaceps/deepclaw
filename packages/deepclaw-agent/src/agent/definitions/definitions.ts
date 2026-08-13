import type { Logger } from '@deepclaw/node-utils';
import {
    SealedAgentHandler, LLMTransitionReason,
    type AgentRuntime, type TokenUsage,
    FlushAgentRole,
    FlushAgent,
} from '@deepclaw/core';
import { AgentConfig } from '@deepclaw/config';

export type LLMProtocol = 'Anthropic' | 'OpenAIChat' | 'OpenAIResponse';

export type FootPrint = {
    type: string;
    content: string;
}

/** What a drawn picture is filed under, so a loop can name the images it produced. */
export const IMAGE_FOOT_PRINT = 'image';

export type SystemPrompt = {
    cacheable: string;
    dynamic: string;
}

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

/**
 * The task a sub loop was spawned for. Kept as a reference instead of a copy of the task, so that
 * every turn reads the state the task is in by then, steps included.
 */
export type AssignedTask = {
    projectId: string;
    taskTitle: string;
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
        newSubLoop: (assignedTask?: AssignedTask) => FlushAgent;
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
