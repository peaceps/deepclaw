import { TokenUsage } from './agent-definitions';
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

const STOP_TRANSITION_REASONS = ['endLoop', 'error',  'refused'] as const;
export type StopTransitionReason = typeof STOP_TRANSITION_REASONS[number];
export function isStopTransitionReason(reason?: LLMTransitionReason): reason is StopTransitionReason {
    return (STOP_TRANSITION_REASONS as readonly string[]).includes(reason ?? '');
}
const CONTINUE_TRANSITION_REASONS = ['toolUse', 'maxTokens', 'inputMaxTokens'] as const;
export type ContinueTransitionReason = typeof CONTINUE_TRANSITION_REASONS[number];
export function isContinueTransitionReason(reason?: LLMTransitionReason): reason is ContinueTransitionReason {
    return (CONTINUE_TRANSITION_REASONS as readonly string[]).includes(reason ?? '');
}

export type LLMTransitionReason = StopTransitionReason | ContinueTransitionReason;

export type AgentBreakReason = AgentStopReason | ExternalInterruptReason | InternalInterruptReason;

const EXTERNAL_INTERRUPT_REASONS = ['clientLost'] as const;
export type ExternalInterruptReason = typeof EXTERNAL_INTERRUPT_REASONS[number];
export function isExternalInterruptReason(reason?: AgentBreakReason): reason is ExternalInterruptReason {
    return (EXTERNAL_INTERRUPT_REASONS as readonly string[]).includes(reason ?? '');
}

const INTERNAL_INTERRUPT_REASONS = ['interactionAfk'] as const;
export type InternalInterruptReason = typeof INTERNAL_INTERRUPT_REASONS[number];
export function isInternalInterruptReason(reason?: AgentBreakReason): reason is InternalInterruptReason {
    return (INTERNAL_INTERRUPT_REASONS as readonly string[]).includes(reason ?? '');
}
export type InvalidInteractionReason = 'timeout' | 'disconnected' | 'error';

const AGENT_STOP_REASONS = ['projectCreated', 'taskPause'] as const;
export type AgentStopReason = typeof AGENT_STOP_REASONS[number];
export function isAgentStopReason(reason?: AgentBreakReason): reason is AgentStopReason {
    return (AGENT_STOP_REASONS as readonly string[]).includes(reason ?? '');
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
    onInfoEvent(event: AgentInfoEvent): void;
}

export type AgentInvokeOptions = {
    browserId: string;
    runtime?: AgentRuntime;
}

export type AgentInvokeResponse = {
    text: string;
    runtime: AgentRuntime;
};

export const BREAK_POINTS = {none: 0, loopStart: 1, callLLM: 2, toolUse: 3, postTurn: 4} as const;
export type BreakPoint = keyof typeof BREAK_POINTS;

export type AgentRuntime = {
    turnCount: number;
    transitionReason?: LLMTransitionReason;
    agentBreakReason?: AgentBreakReason;
    historyPersistIndex: number;
    breakPoint: {
        point: typeof BREAK_POINTS[BreakPoint];
        input?: unknown;
        break?: boolean;
    }
    recoveryState: {
        maxTokenRetries: number;
        refusalState: '' // TODO: 添加拒绝状态
    },
    usage: TokenUsage;
}
