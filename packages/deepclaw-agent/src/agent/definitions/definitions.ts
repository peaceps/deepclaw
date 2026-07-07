import type { Logger } from '@deepclaw/node-utils';
import { SealedAgentHandler, type FlushAgent } from '@deepclaw/core';
import { AgentConfig } from '@deepclaw/config';

export type LLMProtocol = 'Anthropic' | 'OpenAIChat' | 'OpenAIResponse';

export type FootPrint = {
    type: string;
    content: string;
}

export const EXTERNAL_STOP_REASONS = ['clientLost', 'afk'] as const;
export type ExternalStopReason = typeof EXTERNAL_STOP_REASONS[number];
export function isExternalStopReason(reason?: TransitionReason): reason is ExternalStopReason {
    return (EXTERNAL_STOP_REASONS as readonly string[]).includes(reason ?? '');
}

export const TOOL_STOP_REASONS = ['projectCreated', 'taskPause'] as const;
export type ToolStopReason = typeof TOOL_STOP_REASONS[number];
export function isToolStopReason(reason?: TransitionReason): reason is ToolStopReason {
    return (TOOL_STOP_REASONS as readonly string[]).includes(reason ?? '');
}

export type TransitionReason = 'endLoop' | 'toolUse' | 'maxTokens' | 'inputMaxTokens'
    | 'refused' | 'error' | ToolStopReason | ExternalStopReason;

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    agentId: string;
    projectId: string;
    loopId: string;
    clientId: string;
    sessionDir: string;
    isSubLoop: boolean;
    turnCount: number;
    transitionReason?: TransitionReason;
    toolStopText?: string;
    system: string;
    logger: Logger;
    loopConfig: AgentConfig;
    historyPersistIndex: number;
    recoveryState: {
        maxTokenRetries: number;
        refusalState: '' // TODO: 添加拒绝状态
    },
    actions: {
        newSubLoop: (fork?: boolean) => FlushAgent;
        addFootPrint: (footPrint: FootPrint) => void;
        compactIfNeeded: () => Promise<void>;
        agentHandler: SealedAgentHandler;
        addStringMessage: (message: string) => void;
    },
    usage: {
        cachedInputTokens: number;
        cacheCreationInputTokens: number;
        noCachedInputTokens: number;
        outputTokens: number;
    }
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
