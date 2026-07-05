import { LoopGateway, type SSEType } from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import { type AgentEmployee, type Project, type AgentEvent, type AgentInteractionEvent, ChatMessage } from "@deepclaw/core";

export type SSEEventType = 'connected' | 'updateProject' | 'updateAgent' | 'streamText'
    | 'loopBusy' | 'interact' | 'cancelInteract' | 'chat';

export type SSEEvent = {
    sseType: SSEEventType;
    content: unknown;
}

export type SSEConnectedEvent = SSEEvent & {
    sseType: 'connected';
    content: string;
};

export type SSEInfoEvent = SSEEvent & ({
    sseType: 'updateProject'
    content: Partial<Project> & { id: string }
} | {
    sseType: 'updateAgent'
    content: Partial<AgentEmployee> & {id: string}
});

export type SSELoopStreamEvent = SSEEvent & ({
    sseType: 'streamText';
    loopId: string;
    content: string;
    done: boolean;
});

export type SSELoopBusyEvent = SSEEvent & ({
    sseType: 'loopBusy';
    loopId: string;
    busy: boolean;
});

export type SSEInteractEvent = SSEEvent & {
    sseType: 'interact';
    loopId: string;
    clientId: string;
    content: AgentInteractionEvent;
};

export type SSECancelInteractEvent = SSEEvent & {
    sseType: 'cancelInteract';
    loopId: string;
    clientId: string;
    content: '';
};

export type SSEChatEvent = SSEEvent & {
    sseType: 'chat';
    loopId: string;
    clientId: string;
    content: ChatMessage;
};

type SSEClient = {
    id: string;
    loopId?: string;
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
}
type SSEStore = {
    [key in SSEType]: {
        clients: Map<string, SSEClient>;
        unsubscriber?: () => void | undefined;
    }
};

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

    public static removeClient(type: SSEType, id: string): void {
        const store = this.sseStore[type];
        const client = store.clients.get(id);
        if (client && client.loopId) {
            LoopGateway.cancelInteraction(client.loopId, client.id, `Client ${id} disconnected`);
        }
        store.clients.delete(id);
        if (store.clients.size === 0) {
            store.unsubscriber?.();
            store.unsubscriber = undefined;
        }
    }

    private static shouldBroadcast(type: SSEType, client: SSEClient, data: SSEEvent) {
        if (type === 'info') {
            return true;
        }
        if (data.sseType === 'chat') {
            return 'clientId' in data && client.id !== data.clientId;
        }
        if ('clientId' in data) {
            return client.id === data.clientId;
        }
        return 'loopId' in data && client.loopId === data.loopId;
    }

    private static broadcastEvent(type: SSEType, event: SSEEventType, data: SSEEvent): void {
        for (const client of this.sseStore[type].clients.values()) {
            if (this.shouldBroadcast(type, client, data)) {
                this.sendEvent(type, client, event, data);
            }
        }
    }

    private static sendEvent(type: SSEType, client: SSEClient, event: SSEEventType, data: SSEEvent): void {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
            client.controller.enqueue(client.encoder.encode(message));
        } catch (err) {
            this.removeClient(type, client.id);
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
                content: e.message,
            } as SSEChatEvent;
        }
        return {
            sseType: e.type,
            content: e.content
        } as SSEInfoEvent;
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
