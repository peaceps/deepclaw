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
    /**
     * Which stream of this browser it is. A browser comes back under the name it left with, so the
     * name alone cannot tell the stream that ended from the one that took its place.
     */
    streamId: number;
    /** The loops this browser has on screen, the only ones whose events are worth sending it. */
    loops: Set<string>;
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
}
