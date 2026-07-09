import {
    AgentInfoEvent, AgentInteractionEvent, AgentStreamEvent, AgentToolResultEvent,
    AgentInteractionEventPayload
} from './flush-agent-event';

export type LLMGWConfig = {
    model: string,
    timeoutMs: number, // JSON: seconds → client: ms
    temperature: number,
    maxTokens: number
}

export type TransitionReason = 'endLoop' | 'toolUse' | 'maxTokens' | 'inputMaxTokens'
    | 'refused' | 'error' | ToolStopReason | ExternalStopReason | PauseInLoopReason;

export const EXTERNAL_STOP_REASONS = ['clientLost'] as const;
export type ExternalStopReason = typeof EXTERNAL_STOP_REASONS[number];
export function isExternalStopReason(reason?: TransitionReason): reason is ExternalStopReason {
    return (EXTERNAL_STOP_REASONS as readonly string[]).includes(reason ?? '');
}

export const PAUSE_IN_LOOP_REASONS = ['afk'] as const;
export type PauseInLoopReason = typeof PAUSE_IN_LOOP_REASONS[number];
export function isPauseInLoopReason(reason?: TransitionReason): reason is PauseInLoopReason {
    return (PAUSE_IN_LOOP_REASONS as readonly string[]).includes(reason ?? '');
}

export const INVALID_INTERACTION_REASONS = ['timeout', 'disconnected', 'error'] as const;
export type InvalidInteractionReason = typeof INVALID_INTERACTION_REASONS[number];

export const TOOL_STOP_REASONS = ['projectCreated', 'taskPause'] as const;
export type ToolStopReason = typeof TOOL_STOP_REASONS[number];
export function isToolStopReason(reason?: TransitionReason): reason is ToolStopReason {
    return (TOOL_STOP_REASONS as readonly string[]).includes(reason ?? '');
}

export type AgentHandler = {
    onStreamText(e: AgentStreamEvent): void;
    onToolText(e: AgentToolResultEvent): void;
    onInteractionEvent(event: AgentInteractionEvent): Promise<string>;
    onInfoEvent(event: AgentInfoEvent): void;
}

export type SealedAgentHandler = {
    onStreamText(e: Omit<AgentStreamEvent, 'done'|'loopId'|'eventType'>): void;
    onToolText(e: Omit<AgentToolResultEvent, 'eventType'|'loopId'>): void;
    onInteractionEvent(event: AgentInteractionEventPayload & {browserId: string}): Promise<string>;
    onInfoEvent(event: Omit<AgentInfoEvent, 'eventType'>): void;
}

export type AgentInvokeOptions = {
    browserId: string;
    runtime?: AgentRuntime;
}

export type AgentInvokeResponse = {
    text: string;
    runtime: AgentRuntime;
};

export type AgentRuntime = {
    turnCount: number;
    transitionReason?: TransitionReason;
    historyPersistIndex: number;
    recoveryState: {
        maxTokenRetries: number;
        refusalState: '' // TODO: 添加拒绝状态
    },
    usage: {
        cachedInputTokens: number;
        cacheCreationInputTokens: number;
        noCachedInputTokens: number;
        outputTokens: number;
    }
}
