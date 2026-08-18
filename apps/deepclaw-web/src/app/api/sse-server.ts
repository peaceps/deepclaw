import {
    isInfoEvent, isLoopBusyEvent, isLoopCancelInteractionEvent,
    isLoopChatEvent, isLoopInteractionEvent, isLoopStreamEvent,
    LoopGateway, LoopGatewayEvent,
    isLoopTokenUsageEvent
} from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import type { AgentInteractionEvent } from "@deepclaw/core";
import {
    type SSEClient,
    type SSEEvent,
    SSEToastEvent,
} from "./sse-types";

/**
 * One stream carries everything a browser is told. A browser only opens about six connections to a
 * host, so a stream per loop on top of the shared one spent them on listening alone and left the
 * page unable to even load another route: whatever is watched travels with the client instead.
 */
class SSEServerImpl {
    // TODO
    private static logger = getLogger('SSEServer');
    private static clients: Map<string, SSEClient> = new Map();
    private static unsubscriber?: () => void;

    public static addClient(
        browserId: string, controller: ReadableStreamDefaultController, encoder: TextEncoder
    ): void {
        this.unsubscriber ??= LoopGateway.subscribe((e: LoopGatewayEvent) => {
            this.broadcastEvent(e);
        });
        this.clients.set(browserId, {browserId, loops: new Set(), controller, encoder});
    }

    /**
     * Which loops a browser shows, told by the view that opened or left. The events of a loop
     * nobody looks at are a stream of tokens sent for nothing.
     */
    public static watchLoop(browserId: string, loopId: string, watching: boolean): void {
        const client = this.clients.get(browserId);
        if (!client) {
            return;
        }
        if (!watching) {
            client.loops.delete(loopId);
            return;
        }
        client.loops.add(loopId);
        // Whether the loop is busy is the one thing a view that just opened cannot wait for an
        // event to tell it: the loop may have been running long before it got here.
        this.sendEvent(client, {
            eventType: 'busy', loopId, content: '', busy: LoopGateway.isLoopBusy(loopId)
        });
    }

    private static broadcastEvent(event: SSEEvent): void {
        const clients = Array.from(this.clients.values()).filter(client => this.shouldSend(client, event));
        for (const client of clients) {
            this.sendEvent(client, event);
        }
        if (isLoopInteractionEvent(event) && !clients.length) {
            this.handleInteractionPause(event);
        }
    }

    private static handleInteractionPause(event: AgentInteractionEvent) {
        if (this.clients.has(event.browserId)) {
            LoopGateway.cancelInteraction(event.browserId, event.loopId, 'interactionAfk');
            this.sendToast({key: 'interactionPause', data: event.loopId}, event.browserId);
        } else {
          LoopGateway.cancelInteraction(event.browserId, event.loopId, 'disconnected');
        }
    }

    private static shouldSend(client: SSEClient, event: SSEEvent): boolean {
        if (isInfoEvent(event)) {
            return true;
        }
        if (!('loopId' in event) || !client.loops.has(event.loopId)) {
            return false;
        }
        if (isLoopBusyEvent(event) || isLoopTokenUsageEvent(event)) {
            return true;
        } else if (isLoopChatEvent(event)) {
            return 'browserId' in event && client.browserId !== event.browserId;
        } else if (isLoopStreamEvent(event) || isLoopInteractionEvent(event)
            || isLoopCancelInteractionEvent(event)) {
            return 'browserId' in event && client.browserId === event.browserId;
        }
        return false;
    }

    private static sendEvent(client: SSEClient, event: SSEEvent): void {
        const message = `event: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`;
        try {
            client.controller.enqueue(client.encoder.encode(message));
        } catch (err) {
            // Dropped first, so that cancelling cannot come back around to this dead stream.
            this.removeClient(client.browserId);
            // A stream nobody can write to still owes an answer to every loop it was watching.
            for (const loopId of client.loops) {
                LoopGateway.cancelInteraction(client.browserId, loopId, 'error');
            }
            this.logger.error(`Failed to send to client ${client.browserId}: ${err}`);
        }
    }

    public static sendToast(content: SSEToastEvent['content'], browserId: string = ''): void {
        const clients = browserId ? [this.clients.get(browserId)]
            : Array.from(this.clients.values());
        for (const client of clients) {
            if (client) {
                this.sendEvent(client, {
                    eventType: 'toast', content
                } as SSEToastEvent);
            }
        }
    }

    public static removeClient(browserId: string): void {
        if (!this.clients.delete(browserId)) {
            return;
        }
        LoopGateway.disconnectBrowser(browserId);
        if (this.clients.size === 0) {
            this.unsubscriber?.();
            this.unsubscriber = undefined;
        }
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
