import { AgentEvent, AgentInfoEvent } from "@deepclaw/core";
import { LoopGatewayEvent } from "@deepclaw/loop-gateway";

export type SSEType = 'info' | 'loop';

export type SSEEvent = LoopGatewayEvent | SSEConnectedEvent | SSEToastEvent;

export type SSEConnectedEvent = AgentEvent & {
    eventType: 'connected';
    content: string;
};
export type SSEToastEvent = AgentInfoEvent & {
    eventType: 'toast';
    content: {key: string, data: unknown};
}

export type SSEClient = {
    browserId: string;
    loopId?: string;
    active: boolean;
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
}
export type SSEStore = {
    [key in SSEType]: Map<string, SSEClient>;
} & {unsubscriber?: () => void | undefined;};
