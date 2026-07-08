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
        type: SSEType, id: string, loopId: string | undefined,
        controller: ReadableStreamDefaultController, encoder: TextEncoder
    ): void {
        const store = this.sseStore[type];
        if (!store.unsubscriber) {
            store.unsubscriber = LoopGateway.subscribe(type, (e: AgentEvent) => {
                const sseEvent = this.convertToSSEEvent(e);
                this.broadcastEvent(type, sseEvent.sseType, sseEvent);
            });
        }
        const client = { id, loopId, controller, encoder };
        store.clients.set(id, client);

        if (type === 'loop' && loopId) {
            this.sendEvent(type, client, 'loopBusy', {
                sseType: 'loopBusy', loopId, content: '', busy: LoopGateway.isLoopBusy(loopId)
            } as SSELoopBusyEvent);
        }
    }

    private static broadcastEvent(type: SSEType, event: SSEEventType, data: SSEEvent): void {
        for (const client of this.sseStore[type].clients.values()) {
            if (this.shouldBroadcast(type, client, data)) {
                this.sendEvent(type, client, event, data);
            } else if (event === 'interact' && client.id === (data as SSEInteractEvent).clientId) {
                // loopId triggered interaction missing infers user left page
                const interactionData = data as SSEInteractEvent;
                LoopGateway.cancelInteraction(interactionData.loopId, interactionData.clientId, 'afk');
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
            return 'clientId' in data && client.id !== data.clientId
                && 'loopId' in data && client.loopId === data.loopId;
        } else if (data.sseType === 'streamText' || data.sseType === 'interact'
            || data.sseType === 'cancelInteract') {
            return 'clientId' in data && client.id === data.clientId
                && 'loopId' in data && client.loopId === data.loopId;
        }
        return false;
    }

    private static sendEvent(type: SSEType, client: SSEClient, event: SSEEventType, data: SSEEvent): void {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
            client.controller.enqueue(client.encoder.encode(message));
        } catch (err) {
            this.removeClient(type, client.id);
            if (client && client.loopId) {
                LoopGateway.cancelInteraction(client.loopId, client.id, `Client ${client.id} has error.`);
            }
            this.logger.error(`Failed to send to client ${client.id} for ${type}: ${err}`);
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
                clientId: e.clientId,
                content: e.text,
                done: !!e.done
            } as SSELoopStreamEvent;
        }
        if (e.eventType === 'interact') {
            return {
                sseType: 'interact',
                loopId: e.loopId,
                clientId: e.clientId,
                content: e,
            } as SSEInteractEvent;
        }
        if (e.eventType === 'cancelInteract') {
            return {
                sseType: 'cancelInteract',
                loopId: e.loopId,
                clientId: e.clientId,
                content: '',
            } as SSECancelInteractEvent;
        }
        if (e.eventType === 'chat') {
            return {
                sseType: 'chat',
                loopId: e.loopId,
                clientId: e.clientId,
                update: e.update,
                content: e.message,
            } as SSEChatEvent;
        }
        return {
            sseType: e.type,
            content: e.content
        } as SSEEvent;
    }

    public static removeClient(type: SSEType, id: string): void {
        const store = this.sseStore[type];
        const client = store.clients.get(id);
        if (type === 'info') {
            LoopGateway.disconnectBrowser(id);
        }
        store.clients.delete(id);
        if (store.clients.size === 0) {
            store.unsubscriber?.();
            store.unsubscriber = undefined;
        }
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
