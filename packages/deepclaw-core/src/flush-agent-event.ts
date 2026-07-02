import { AgentEmployee } from "./agent-definitions";
import { Project } from "./project-definitions";
import { DistributiveOmit } from "@deepclaw/utils";

export function getFlushAgentKey(agentId: string, projectId?: string): string {
    return !projectId ? agentId : `${agentId}.${projectId}`;
}

export type AgentEvent = AgentInfoEvent | AgentStreamEvent |
    AgentLoopBusyEvent | AgentInteractionEvent;

type AgentEventType = 'info' | 'stream' | 'busy' | 'interact' | 'toolResult';

type FlushAgentEvent = {
    eventType: AgentEventType;
}

export type AgentStreamEvent = FlushAgentEvent & {
    eventType: 'stream';
    loopId: string;
    text: string;
    done?: boolean;
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

export type AgentInteractionEventConfig = DistributiveOmit<AgentInteractionEvent, 'eventType' | 'loopId'>;

export type AgentInfoEvent = FlushAgentEvent & {eventType: 'info'} & ({
    type: 'updateProject',
    content: Partial<Project> & {id: string}
} | {
    type: 'updateAgent',
    content: Partial<AgentEmployee> & {id: string}
});
