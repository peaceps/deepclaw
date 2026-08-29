import { TokenUsage, type ImageContent } from './agent-definitions';
import {
    AgentInfoEvent, AgentInteractionEvent, AgentStreamEvent,
    AgentInteractionEventPayload
} from './flush-agent-event';

export type LLMGWConfig = {
    model: string,
    timeoutMs: number, // JSON: seconds → client: ms
    maxTokens: number
}

export type FlushAgentRole = 'agent' | 'project' | 'cron';

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

const EXTERNAL_INTERRUPT_REASONS = ['clientLost', 'userStopped'] as const;
export type ExternalInterruptReason = typeof EXTERNAL_INTERRUPT_REASONS[number];
export function isExternalInterruptReason(reason?: AgentBreakReason): reason is ExternalInterruptReason {
    return (EXTERNAL_INTERRUPT_REASONS as readonly string[]).includes(reason ?? '');
}

const INTERNAL_INTERRUPT_REASONS = ['interactionAfk'] as const;
export type InternalInterruptReason = typeof INTERNAL_INTERRUPT_REASONS[number];
export function isInternalInterruptReason(reason?: AgentBreakReason): reason is InternalInterruptReason {
    return (INTERNAL_INTERRUPT_REASONS as readonly string[]).includes(reason ?? '');
}
const INVALID_INTERACTION_REASONS = ['timeout', 'disconnected', 'error'] as const;
export type InvalidInteractionReason = typeof INVALID_INTERACTION_REASONS[number];
export function isInvalidInteractionReason(reason?: string): reason is InvalidInteractionReason {
    return (INVALID_INTERACTION_REASONS as readonly string[]).includes(reason ?? '');
}
/**
 * A question taken back because the run it belongs to was stopped, which is neither of the two
 * above and must not be read as either: an internal interrupt marks the user away and holds every
 * later question of the run against a silence that was never theirs, and an invalid interaction
 * says there was nobody to ask. Here the user was there and said stop.
 */
const STOPPED_INTERACTION_REASONS = ['userStopped'] as const;
export type StoppedInteractionReason = typeof STOPPED_INTERACTION_REASONS[number];
export function isStoppedInteractionReason(reason?: string): reason is StoppedInteractionReason {
    return (STOPPED_INTERACTION_REASONS as readonly string[]).includes(reason ?? '');
}

const AGENT_STOP_REASONS = ['projectCreated', 'taskPause'] as const;
export type AgentStopReason = typeof AGENT_STOP_REASONS[number];
export function isAgentStopReason(reason?: AgentBreakReason): reason is AgentStopReason {
    return (AGENT_STOP_REASONS as readonly string[]).includes(reason ?? '');
}

export type AgentHandler = {
    onStreamText(e: AgentStreamEvent): void;
    onInteractionEvent(event: AgentInteractionEvent): Promise<string>;
    onInfoEvent(event: AgentInfoEvent): void;
}

export type SealedAgentHandler = {
    onStreamText(e: Omit<AgentStreamEvent, 'done'|'loopId'|'eventType'>): void;
    onInteractionEvent(event: AgentInteractionEventPayload & {browserId: string}): Promise<string>;
    onInfoEvent(event: AgentInfoEvent): void;
}

export type AgentInvokeOptions = {
    browserId: string;
    images?: ImageContent[];
    agentHandler?: Partial<Omit<SealedAgentHandler, 'onInfoEvent'>>;
    /**
     * Cuts short whatever the run is waiting on, so that a stop does not have to wait out an LLM
     * stream, a command or the ten minutes a question is allowed. It belongs to the run rather
     * than to the loop: every run gets one of its own, and a loop spawned by this one is handed
     * the very same signal so that a stop reaches all the way down.
     */
    abortSignal?: AbortSignal;
}

/**
 * What a run leaves behind, in the two shapes it is read in.
 *
 * A chat watched every word of it go by and keeps all of them: replacing that with the last of
 * them would take back off the screen everything the run had put on it, and would leave the file
 * saying something other than what the user read. Everywhere else a run is read rather than
 * watched -- a reply carried to IM, the line under a closed conversation -- and there the last
 * word is the answer, the rest being work shown to nobody who asked for it.
 */
export type AgentInvokeResponse = {
    text: string;
    said: string;
    runtime: AgentRuntime;
};

export type AgentRuntime = {
    turnCount: number;
    transitionReason?: LLMTransitionReason;
    agentBreakReason?: AgentBreakReason;
    /**
     * What the run says for itself where a tool ended it, in the user's own words. A stop leaves
     * it unset and is worded where every other ending is: only a tool knows enough about the
     * ending it caused to say more than the reason for it.
     */
    agentBreakDetail?: string;
    /**
     * The run stopped because it had used every turn it is allowed, which the reason it stops with
     * cannot say: a run that ran out mid-work ends the loop the way a run that had said everything
     * it had to say ends it. Whoever has to tell the two apart -- a loop reading what a subagent
     * it spawned got through -- reads it here.
     */
    hitTurnLimit?: boolean;
    historyPersistIndex: number;
    recoveryState: {
        maxTokenRetries: number;
        inputMaxTokenRetries: number;
        refusalState: '' // TODO: 添加拒绝状态
    },
    usage: TokenUsage;
}

export type LLMTaskOutput = {
    /**
     * An output holds what the user reads, so 'binary' is nothing a task can produce any more. It
     * stands here for the records that were written while it could.
     */
    type: 'markdown' | 'text' | 'binary';
    content: string;
    path?: string;
    ext?: string;
}
