import {
    AgentAgentInfoEvent, AgentCronInfoEvent, AgentEvent, AgentInfoEvent,
    AgentInteractionEvent, AgentLoopEvent, AgentProjectInfoEvent,
    AgentStreamEvent, ChatMessage,
    TokenUsage
} from "@deepclaw/core";

export type { SkillInfo } from "@deepclaw/agent";

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

export type LoopGatewayEvent = AgentEvent | AgentLoopBusyEvent | AgentChatEvent | AgentCancelInteractionEvent | AgentTokenUsageEvent;

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
export function isProjectInfoEvent(event: AgentEvent): event is AgentProjectInfoEvent {
    return event.eventType === 'updateProject';
}
export function isAgentInfoEvent(event: AgentEvent): event is AgentAgentInfoEvent {
    return event.eventType === 'updateAgent';
}
export function isCronInfoEvent(event: AgentEvent): event is AgentCronInfoEvent {
    return event.eventType === 'updateCron';
}

export function isLoopEvent(event: AgentEvent): event is AgentLoopEvent {
    return isLoopBusyEvent(event) || isLoopStreamEvent(event) || isLoopInteractionEvent(event) || isLoopCancelInteractionEvent(event)
        || isLoopChatEvent(event) || isLoopTokenUsageEvent(event);
}
export function isInfoEvent(event: AgentEvent): event is AgentInfoEvent {
    return isProjectInfoEvent(event) || isAgentInfoEvent(event) || isCronInfoEvent(event);
}

export function getClientKey(browserId: string, loopId?: string): string {
    return loopId ? `${browserId}::${loopId}` : browserId;
}
