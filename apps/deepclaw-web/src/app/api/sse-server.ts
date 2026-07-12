import { isInfoEvent, isLoopBusyEvent, isLoopCancelInteractionEvent, isLoopChatEvent, isLoopEvent, isLoopInteractionEvent, isLoopStreamEvent, LoopGateway, LoopGatewayEvent } from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import type { AgentInteractionEvent } from "@deepclaw/core";
import {
    type SSEStore,
    type SSEClient,
    type SSEEvent,
    SSEToastEvent,
    type SSEType,
} from "./sse-types";

class SSEServerImpl {
    // TODO
    private static logger = getLogger('SSEServer');
    private static sseStore: SSEStore = {
        info: new Map<string, SSEClient>(),
        loop: new Map<string, SSEClient>(),
    }

    public static addClient(
        type: SSEType, browserId: string, loopId: string | undefined,
        controller: ReadableStreamDefaultController, encoder: TextEncoder
    ): void {
        if (type === 'info' && !this.sseStore.unsubscriber) {
            this.sseStore.unsubscriber = LoopGateway.subscribe((e: LoopGatewayEvent) => {
                this.broadcastEvent(e);
            });
        }
        const store = this.sseStore[type];
        const client: SSEClient = { browserId, loopId, controller, encoder, active: true };
        store.set(this.getClientKey(type, browserId, loopId), client);

        if (type === 'loop' && loopId) {
            this.sendEvent(type, client, {
                eventType: 'busy', loopId, content: '', busy: LoopGateway.isLoopBusy(loopId)
            });
        }
    }

    private static broadcastEvent(event: SSEEvent): void {
        const type = this.getSSEType(event);
        const allClients = Array.from(this.sseStore[type].values());
        const clients = allClients.filter(client => this.shouldBroadcast(client, event));
        for (const client of clients) {
            this.sendEvent(type, client, event);
        }
        if (isLoopInteractionEvent(event) && !clients.length) {
            this.handleInteractionPause(event);
        }
    }

    private static handleInteractionPause(event: AgentInteractionEvent) {
        const infoClient = this.sseStore['info'].get(event.browserId);
        if (infoClient) {
            LoopGateway.cancelInteraction(event.browserId, event.loopId, 'interactionAfk');

            this.sendEvent('info', infoClient, {
                eventType: 'toast', content: {key: 'interactionPause', data: event.loopId}
            } as SSEToastEvent);
        } else {
          LoopGateway.cancelInteraction(event.browserId, event.loopId, 'disconnected');
        }
    }

    private static shouldBroadcast(client: SSEClient, event: SSEEvent): boolean {
        if (isInfoEvent(event)) {
            return true;
        }
        if (!this.sseStore.info.get(client.browserId)) {
            return false;
        }
        if (isLoopBusyEvent(event)) {
            return 'loopId' in event && client.loopId === event.loopId;
        } else if (isLoopChatEvent(event)) {
            return 'browserId' in event && client.browserId !== event.browserId
                && 'loopId' in event && client.loopId === event.loopId;
        } else if (isLoopStreamEvent(event)) {
            return this.matchClient(event, client);
        } else if (isLoopInteractionEvent(event) || isLoopCancelInteractionEvent(event)) {
            return client.active && this.matchClient(event, client);
        }
        return false;
    }

    private static matchClient(event: SSEEvent, client: SSEClient): boolean {
        return 'browserId' in event && client.browserId === event.browserId
            && 'loopId' in event && client.loopId === event.loopId;
    }

    private static sendEvent(type: SSEType, client: SSEClient, event: SSEEvent): void {
        const message = `event: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`;
        try {
            client.controller.enqueue(client.encoder.encode(message));
        } catch (err) {
            this.removeClient(type, client.browserId, client.loopId);
            if (client && client.loopId) {
                LoopGateway.cancelInteraction(client.browserId, client.loopId, 'error');
            }
            this.logger.error(`Failed to send to client ${client.browserId} for ${type}: ${err}`);
        }
    }

    public static removeClient(type: SSEType, browserId: string, loopId?: string): void {
        const store = this.sseStore[type];
        store.delete(this.getClientKey(type, browserId, loopId));
        if (type === 'info') {
            LoopGateway.disconnectBrowser(browserId);
            if (store.size === 0) {
                this.sseStore.unsubscriber?.();
                this.sseStore.unsubscriber = undefined;
            }
        }
    }

    public static activeClient(browserId: string, loopId: string, active: boolean): void {
        const store = this.sseStore.loop;
        for (const client of store.values()) {
            if (client.browserId === browserId && client.loopId === loopId) {
                client.active = active;
            }
        }
    }

    private static getClientKey(type: SSEType, browserId: string, loopId?: string): string {
        return type === 'info' ? browserId : `${browserId}::${loopId}`;
    }

    private static getSSEType(event: SSEEvent): SSEType {
        if ( isInfoEvent(event) ) {
            return 'info';
        } else if (isLoopEvent(event)) {
            return 'loop';
        }
        return 'info';
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
