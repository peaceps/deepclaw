import { AgentEmployee } from "./agent-definitions";
import { FlushAgentRole } from "./flush-agent-types";
import { Project, RunningTask } from "./project-definitions";
import { DistributiveOmit, UpdateContent } from "@deepclaw/utils";
import { CronTask } from "./cron-definitions";

export function getLoopId(role: FlushAgentRole, agentId: string, projectId?: string): string {
    return !projectId ? `${role}.${agentId}` : `${role}.${agentId}.${projectId}`;
}

export function splitLoopId(key: string): {role: FlushAgentRole; agentId: string; projectId?: string} {
    const [role, agentId, projectId] = key.split('.');
    return {role: role as FlushAgentRole, agentId: agentId ?? '', projectId};
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
    tag?: string;
    done?: boolean;
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

export type AgentInteractionEventPayload =
    DistributiveOmit<AgentInteractionEvent, 'eventType' | 'loopId' | 'browserId'>;

export type AgentInfoEvent = FlushAgentEvent & {
    content: unknown
}

export type AgentProjectInfoEvent = AgentInfoEvent & {
    eventType: 'updateProject',
    content: UpdateContent<Project>
};

export type AgentAgentInfoEvent = AgentInfoEvent & {
    eventType: 'updateAgent',
    content: UpdateContent<AgentEmployee>
}

export type AgentCronInfoEvent = AgentInfoEvent & {
    eventType: 'updateCron',
    content: UpdateContent<CronTask>
}

/** The whole list every time: it is a handful of entries and a lost delta would strand one of them. */
export type AgentRunningTasksInfoEvent = AgentInfoEvent & {
    eventType: 'updateRunningTasks',
    content: RunningTask[]
}

/**
 * The loops that are working, by id. A busy event travels to whoever watches that one loop, while
 * this one tells a page that watches no loop at all which of its agents are at work.
 */
export type AgentBusyLoopsInfoEvent = AgentInfoEvent & {
    eventType: 'updateBusyLoops',
    content: string[]
}
