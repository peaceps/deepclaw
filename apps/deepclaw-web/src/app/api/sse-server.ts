import { LoopGateway, type SSEType } from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import { type AgentEmployee, type Project } from "@deepclaw/core";
import type { LoopSSEEvent } from "@deepclaw/loop-gateway";

export type SSEEvent = {
    sseType: string;
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
        info: {
            clients: new Map<string, SSEClient>(),
        },
        loop: {
            clients: new Map<string, SSEClient>(),
        }
    }

    public static addClient(
        type: SSEType, id: string, loopId: string | undefined,
        controller: ReadableStreamDefaultController, encoder: TextEncoder
    ): void {
        const store = this.sseStore[type];
        if (!store.unsubscriber) {
            store.unsubscriber = LoopGateway.subscribe(type, (e: LoopSSEEvent) => {
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
        store.clients.delete(id);
        if (store.clients.size === 0) {
            store.unsubscriber?.();
            store.unsubscriber = undefined;
        }
    }

    private static broadcastEvent(type: SSEType, event: string, data: SSEEvent): void {
        for (const client of this.sseStore[type].clients.values()) {
            if (type === 'loop' && ( !('loopId' in data) || client.loopId !== data.loopId)) {
                continue;
            }
            this.sendEvent(type, client, event, data);
        }
    }

    private static sendEvent(type: SSEType, client: SSEClient, event: string, data: SSEEvent): void {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
            client.controller.enqueue(client.encoder.encode(message));
        } catch (err) {
            this.removeClient(type, client.id);
            this.logger.error(`Failed to send to client ${client.id} for ${type}: ${err}`);
        }
    }

    private static convertToSSEEvent(e: LoopSSEEvent): SSEEvent {
        if ('busy' in e) {
            return {
                sseType: 'loopBusy',
                loopId: e.loopId,
                content: '',
                busy: e.busy
            } as SSELoopBusyEvent;
        }
        if ('text' in e) {
            return {
                sseType: 'streamText',
                loopId: e.loopId,
                content: e.text,
                done: !!e.done
            } as SSELoopStreamEvent;
        }
        return {
            sseType: e.type,
            content: e.content
        } as SSEInfoEvent;
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
