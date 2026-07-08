import { LoopGateway, type SSEType } from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import { type AgentEvent } from "@deepclaw/core";
import {
    type SSEStore,
    type SSEClient,
    type SSEInfoEventType,
    type SSEEvent,
    type SSELoopStreamEvent,
    type SSELoopBusyEvent,
    type SSEInteractEvent,
    type SSECancelInteractEvent,
    type SSEChatEvent,
    INFO_SSE_TYPES,
    SSEEventType 
} from "./sse-types";

class SSEServerImpl {
    // TODO
    private static logger = getLogger('SSEServer');
    private static sseStore: SSEStore = {
        info: { clients: new Map<string, SSEClient>(), },
        loop: { clients: new Map<string, SSEClient>(), }
    }

    public static addClient(
        type: SSEType, browserId: string, loopId: string | undefined,
        controller: ReadableStreamDefaultController, encoder: TextEncoder
    ): void {
        const store = this.sseStore[type];
        if (!store.unsubscriber) {
            store.unsubscriber = LoopGateway.subscribe(type, (e: AgentEvent) => {
                const sseEvent = this.convertToSSEEvent(e);
                this.broadcastEvent(type, sseEvent.sseType, sseEvent);
            });
        }
        const client: SSEClient = { browserId, loopId, controller, encoder, active: true };
        store.clients.set(this.getClientKey(type, browserId, loopId), client);

        if (type === 'loop' && loopId) {
            this.sendEvent(type, client, 'loopBusy', {
                sseType: 'loopBusy', loopId, content: '', busy: LoopGateway.isLoopBusy(loopId)
            } as SSELoopBusyEvent);
        }
    }

    private static broadcastEvent(type: SSEType, event: SSEEventType, data: SSEEvent): void {
        const allClients = Array.from(this.sseStore[type].clients.values());
        const clients = allClients.filter(client => this.shouldBroadcast(type, client, data));
        for (const client of clients) {
            this.sendEvent(type, client, event, data);
        }
        if (event === 'interact') {
            const browserOpen = allClients.some(client => client.browserId === (data as SSEInteractEvent).browserId);
            if (browserOpen && !clients.length) {
                const interactionData = data as SSEInteractEvent;
                LoopGateway.cancelInteraction(interactionData.browserId, interactionData.loopId, 'afk');
            }
        }
    }

    private static shouldBroadcast(type: SSEType, client: SSEClient, data: SSEEvent): boolean {
        if (type === 'info' && INFO_SSE_TYPES.includes(data.sseType as SSEInfoEventType)) {
            return true;
        }
        if (data.sseType === 'loopBusy') {
            return 'loopId' in data && client.loopId === data.loopId;
        } else if (data.sseType === 'chat') {
            return 'browserId' in data && client.browserId !== data.browserId
                && 'loopId' in data && client.loopId === data.loopId;
        } else if (data.sseType === 'streamText') {
            return this.matchClient(data, client);
        } else if (data.sseType === 'interact' || data.sseType === 'cancelInteract') {
            return client.active && this.matchClient(data, client);
        }
        return false;
    }

    private static matchClient(data: SSEEvent, client: SSEClient): boolean {
        return 'browserId' in data && client.browserId === data.browserId
            && 'loopId' in data && client.loopId === data.loopId;
    }

    private static sendEvent(type: SSEType, client: SSEClient, event: SSEEventType, data: SSEEvent): void {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

    private static convertToSSEEvent(e: AgentEvent): SSEEvent {
        if (e.eventType === 'busy') {
            return {
                sseType: 'loopBusy',
                loopId: e.loopId,
                content: '',
                busy: e.busy
            } as SSELoopBusyEvent;
        }
        if (e.eventType === 'stream') {
            return {
                sseType: 'streamText',
                loopId: e.loopId,
                browserId: e.browserId,
                content: e.text,
                done: !!e.done
            } as SSELoopStreamEvent;
        }
        if (e.eventType === 'interact') {
            return {
                sseType: 'interact',
                loopId: e.loopId,
                browserId: e.browserId,
                content: e,
            } as SSEInteractEvent;
        }
        if (e.eventType === 'cancelInteract') {
            return {
                sseType: 'cancelInteract',
                loopId: e.loopId,
                browserId: e.browserId,
                content: '',
            } as SSECancelInteractEvent;
        }
        if (e.eventType === 'chat') {
            return {
                sseType: 'chat',
                loopId: e.loopId,
                browserId: e.browserId,
                update: e.update,
                content: e.message,
            } as SSEChatEvent;
        }
        return {
            sseType: e.type,
            content: e.content
        } as SSEEvent;
    }

    public static removeClient(type: SSEType, browserId: string, loopId?: string): void {
        const store = this.sseStore[type];
        if (type === 'info') {
            LoopGateway.disconnectBrowser(browserId);
        }
        store.clients.delete(this.getClientKey(type, browserId, loopId));
        if (store.clients.size === 0) {
            store.unsubscriber?.();
            store.unsubscriber = undefined;
        }
    }

    public static resetClient(browserId: string, loopId: string): void {
        const store = this.sseStore.loop;
        for (const client of store.clients.values()) {
            if (client.browserId === browserId) {
                client.active = client.loopId === loopId;
            }
        }
    }

    private static getClientKey(type: SSEType, browserId: string, loopId?: string): string {
        return type === 'info' ? browserId : `${browserId}::${loopId}`;
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
