import {
    AgentAgentInfoEvent, AgentBusyLoopsInfoEvent, AgentCronInfoEvent, AgentEvent, AgentInfoEvent,
    AgentInteractionEvent, AgentLoopEvent, AgentProjectInfoEvent, AgentRuntimeStatusInfoEvent,
    AgentRunningTasksInfoEvent, AgentStreamEvent, ChatMessage,
    FlushAgentRole,
    ImageContent,
    TokenUsage
} from "@deepclaw/core";

export type { SkillInfo, SessionSummary } from "@deepclaw/agent";

export type InvokeSource = 'web' | 'tui' | 'im';

export type InvokeOption = {
    source: InvokeSource;
    browserId?: string;
    images?: ImageContent[];
}

export type LoopInfo = {
    role: FlushAgentRole;
    agentId: string;
    projectId?: string;
};

/**
 * Why a conversation was not closed, for a view to say it in its own words. A run that is still
 * going and a command still writing into the session folder are what it is refused for; the folder
 * failing to move is the conversation staying open despite nothing being in the way.
 */
export type NewSessionRefusal = 'busy' | 'backgroundCommand' | 'unsupported' | 'archiveFailed';

/** The id names the conversation that was archived, and is absent when there was nothing to keep. */
export type NewSessionResult =
    {started: true, sessionId?: string} | {started: false, reason: NewSessionRefusal};

export type AgentLoopBusyEvent = AgentLoopEvent & {
    eventType: 'busy';
    busy: boolean;
};

export type AgentCancelInteractionEvent = AgentLoopEvent & {
    eventType: 'cancelInteraction';
    browserId: string;
};

export type AgentChatEvent = AgentLoopEvent & {
    eventType: 'chat';
    browserId: string;
    update: boolean;
    message: ChatMessage;
};

export type AgentTokenUsageEvent = AgentLoopEvent & {
    eventType: 'tokenUsage';
    usage: TokenUsage;
};

/**
 * The conversation of this loop was closed and an empty one took its place. Every view of the loop
 * is told, not only the one that asked: a tab still showing the old transcript would go on adding
 * to a record of a conversation that no longer exists.
 */
export type AgentSessionResetEvent = AgentLoopEvent & {
    eventType: 'sessionReset';
};

export type LoopGatewayEvent = AgentEvent | AgentLoopBusyEvent | AgentChatEvent | AgentCancelInteractionEvent | AgentTokenUsageEvent | AgentSessionResetEvent;

export function isLoopBusyEvent(event: AgentEvent): event is AgentLoopBusyEvent {
    return event.eventType === 'busy';
}
export function isLoopStreamEvent(event: AgentEvent): event is AgentStreamEvent {
    return event.eventType === 'stream';
}
export function isLoopInteractionEvent(event: AgentEvent): event is AgentInteractionEvent {
    return event.eventType === 'interaction';
}
export function isLoopCancelInteractionEvent(event: AgentEvent): event is AgentCancelInteractionEvent {
    return event.eventType === 'cancelInteraction';
}
export function isLoopChatEvent(event: AgentEvent): event is AgentChatEvent {
    return event.eventType === 'chat';
}
export function isLoopTokenUsageEvent(event: AgentEvent): event is AgentTokenUsageEvent {
    return event.eventType === 'tokenUsage';
}
export function isLoopSessionResetEvent(event: AgentEvent): event is AgentSessionResetEvent {
    return event.eventType === 'sessionReset';
}
export function isProjectInfoEvent(event: AgentEvent): event is AgentProjectInfoEvent {
    return event.eventType === 'updateProject';
}
export function isAgentInfoEvent(event: AgentEvent): event is AgentAgentInfoEvent {
    return event.eventType === 'updateAgent';
}
export function isCronInfoEvent(event: AgentEvent): event is AgentCronInfoEvent {
    return event.eventType === 'updateCron';
}
export function isAgentRuntimeStatusInfoEvent(event: AgentEvent): event is AgentRuntimeStatusInfoEvent {
    return event.eventType === 'updateAgentRuntime';
}
export function isRunningTasksInfoEvent(event: AgentEvent): event is AgentRunningTasksInfoEvent {
    return event.eventType === 'updateRunningTasks';
}
export function isBusyLoopsInfoEvent(event: AgentEvent): event is AgentBusyLoopsInfoEvent {
    return event.eventType === 'updateBusyLoops';
}

export function isLoopEvent(event: AgentEvent): event is AgentLoopEvent {
    return isLoopBusyEvent(event) || isLoopStreamEvent(event) || isLoopInteractionEvent(event) || isLoopCancelInteractionEvent(event)
        || isLoopChatEvent(event) || isLoopTokenUsageEvent(event) || isLoopSessionResetEvent(event);
}
export function isInfoEvent(event: AgentEvent): event is AgentInfoEvent {
    return isProjectInfoEvent(event) || isAgentInfoEvent(event) || isCronInfoEvent(event)
        || isRunningTasksInfoEvent(event) || isBusyLoopsInfoEvent(event) || isAgentRuntimeStatusInfoEvent(event);
}
