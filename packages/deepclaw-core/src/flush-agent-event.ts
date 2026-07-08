import { AgentEmployee, ChatMessage } from "./agent-definitions";
import { Project } from "./project-definitions";
import { DistributiveOmit } from "@deepclaw/utils";

export function getFlushAgentKey(agentId: string, projectId?: string): string {
    return !projectId ? agentId : `${agentId}.${projectId}`;
}

export function splitFlushAgentKey(key: string): {agentId: string; projectId?: string} {
    const [agentId, projectId] = key.split('.');
    return {agentId: agentId ?? '', projectId};
}

export function getInteractionId(browserId: string, loopId: string): string {
    return `${browserId}_${loopId}`;
}

export const LOOP_BUSY_ERROR = 'LOOP_BUSY';

export type AgentEvent = AgentInfoEvent | AgentStreamEvent | AgentChatEvent |
    AgentLoopBusyEvent | AgentInteractionEvent | AgentCancelInteractionEvent;

type AgentEventType = 'info' | 'stream' | 'busy' | 'interact' | 'chat' | 'cancelInteract' | 'toolResult';

type FlushAgentEvent = {
    eventType: AgentEventType;
}

export type AgentStreamEvent = FlushAgentEvent & {
    eventType: 'stream';
    loopId: string;
    browserId: string;
    text: string;
    done?: boolean;
};

export type AgentChatEvent = FlushAgentEvent & {
    eventType: 'chat';
    loopId: string;
    browserId: string;
    update: boolean;
    message: ChatMessage;
};

export type AgentToolResultEvent = FlushAgentEvent & {
    eventType: 'toolResult';
    loopId: string;
    toolName: string;
    data: any;
};

export type AgentLoopBusyEvent = FlushAgentEvent & {
    eventType: 'busy';
    loopId: string;
    busy: boolean;
};

export type AgentInteractionEventOption = string | {label: string; value: string};

export type AgentInteractionEvent = FlushAgentEvent & {
    eventType: 'interact';
    loopId: string;
    browserId: string;
    content: string;
    i18nParam?: Record<string, string | number>;
    key?: string;
} & ({
    type: 'readonly';
} | {
    type: 'input';
} | {
    type: 'select';
    options: AgentInteractionEventOption[];
});

export type AgentInteractionEventPayload = DistributiveOmit<AgentInteractionEvent, 'eventType' | 'loopId' | 'browserId'>;

export type AgentCancelInteractionEvent = FlushAgentEvent & {
    eventType: 'cancelInteract';
    loopId: string;
    browserId: string;
};

export type AgentInfoEvent = FlushAgentEvent & {eventType: 'info'} & ({
    type: 'updateProject',
    content: Partial<Project> & {id: string}
} | {
    type: 'updateAgent',
    content: Partial<AgentEmployee> & {id: string}
});
