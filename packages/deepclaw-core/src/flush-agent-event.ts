import { AgentEmployee } from "./agent-definitions";
import { Project } from "./project-definitions";
import { DistributiveOmit } from "@deepclaw/utils";

export function getLoopId(agentId: string, projectId?: string): string {
    return !projectId ? agentId : `${agentId}.${projectId}`;
}

export function splitLoopId(key: string): {agentId: string; projectId?: string} {
    const [agentId, projectId] = key.split('.');
    return {agentId: agentId ?? '', projectId};
}

export const LOOP_BUSY_ERROR = 'LOOP_BUSY';

export type AgentEvent = AgentInfoEvent | AgentLoopEvent;

type FlushAgentEvent = {
    eventType: string;
}

export type AgentLoopEvent = FlushAgentEvent & {
    loopId: string;
}

export type AgentStreamEvent = AgentLoopEvent & {
    eventType: 'stream';
    browserId: string;
    text: string;
    done?: boolean;
};

export type AgentToolResultEvent = AgentLoopEvent & {
    eventType: 'toolResult';
    toolName: string;
    data: any;
};

export type AgentInteractionEventOption = string | {label: string; value: string};

export type AgentInteractionEvent = AgentLoopEvent & {
    eventType: 'interaction';
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

export type AgentInfoEvent = FlushAgentEvent & {
    content: unknown
}

export type AgentProjectInfoEvent = AgentInfoEvent & {
    eventType: 'updateProject',
    content: Partial<Project> & {id: string}
};

export type AgentAgentInfoEvent = AgentInfoEvent & {
    eventType: 'updateAgent',
    content: Partial<AgentEmployee> & {id: string}
}
