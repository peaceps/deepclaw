import { AgentEvent, AgentInfoEvent } from "@deepclaw/core";
import { LoopGatewayEvent } from "@deepclaw/loop-gateway";

export type SSEEvent = LoopGatewayEvent | SSEConnectedEvent | SSEToastEvent;

export type SSEConnectedEvent = AgentEvent & {
    eventType: 'connected';
    content: string;
};

export type SSEToastKey = 'interactionPause' | 'imConnected' | 'imConnectFailed';
export type SSEToastEvent = AgentInfoEvent & {
    eventType: 'toast';
    content: {key: SSEToastKey, data: unknown};
}

export type SSEClient = {
    browserId: string;
    /** The loops this browser has on screen, the only ones whose events are worth sending it. */
    loops: Set<string>;
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
}
