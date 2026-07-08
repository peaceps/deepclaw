import { AgentEmployee, AgentInteractionEvent, ChatMessage, Project } from "@deepclaw/core";
import { SSEType } from "@deepclaw/loop-gateway";

export const INFO_SSE_TYPES = ['updateProject', 'updateAgent'] as const;
export const LOOP_SSE_TYPES = ['streamText', 'loopBusy', 'interact', 'cancelInteract', 'chat'] as const;
export type SSEInfoEventType = typeof INFO_SSE_TYPES[number];
export type SSELoopEventType = typeof LOOP_SSE_TYPES[number];

export type SSEEventType = 'connected' | SSEInfoEventType | SSELoopEventType;
export type SSEEvent = {
    sseType: SSEEventType;
    content: unknown;
}

export type SSEConnectedEvent = SSEEvent & {
    sseType: 'connected';
    content: string;
};

type SSEInfoEvent = SSEEvent & ({
    sseType: SSEInfoEventType;
});
export type SSEProjectInfoEvent = SSEInfoEvent & ({
    sseType: 'updateProject'
    content: Partial<Project> & { id: string }
});
export type SSEAgentInfoEvent = SSEInfoEvent & ({
    sseType: 'updateAgent'
    content: Partial<AgentEmployee> & {id: string}
});

type SSELoopEvent = SSEEvent & ({
    sseType: SSELoopEventType;
    loopId: string;
});
export type SSELoopStreamEvent = SSELoopEvent & ({
    sseType: 'streamText';
    clientId: string;
    content: string;
    done: boolean;
});
export type SSELoopBusyEvent = SSELoopEvent & ({
    sseType: 'loopBusy';
    busy: boolean;
});
export type SSEInteractEvent = SSELoopEvent & {
    sseType: 'interact';
    clientId: string;
    content: AgentInteractionEvent;
};
export type SSECancelInteractEvent = SSELoopEvent & {
    sseType: 'cancelInteract';
    clientId: string;
    content: '';
};
export type SSEChatEvent = SSELoopEvent & {
    sseType: 'chat';
    clientId: string;
    update: boolean;
    content: ChatMessage;
};

export type SSEClient = {
    id: string;
    loopId?: string;
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
}
export type SSEStore = {
    [key in SSEType]: {
        clients: Map<string, SSEClient>;
        unsubscriber?: () => void | undefined;
    }
};
