import { LoopGateway, type SSEType } from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import type { AgentEmployee, AgentInfoEvent, AgentStreamEvent, Project } from "@deepclaw/core";

export type SSEEvent = {
    sseType: string;
    content: unknown;
}

export type SSEConnectedEvent = SSEEvent & {
    sseType: 'connected';
    clientId: string;
};

export type SSEInfoEvent = SSEEvent & ({
    sseType: 'updateProject'
    content: Project
} | {
    sseType: 'updateAgent'
    content: Partial<AgentEmployee> & {id: string}
});

export type SSELoopStreamEvent = SSEEvent & ({
    sseType: 'streamText';
    chatKey: string;
    content: string;
    done: boolean;
});

type SSEClient = {
    id: string;
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
        type: SSEType, id: string, controller: ReadableStreamDefaultController, encoder: TextEncoder
    ): void {
        const store = this.sseStore[type];
        if (!store.unsubscriber) {
            store.unsubscriber = LoopGateway.subscribe(type, (e: AgentInfoEvent | AgentStreamEvent) => {
                const sseEvent = this.convertToSSEEvent(e);
                this.broadcastEvent(type, sseEvent.sseType, sseEvent);
            });
        }
        store.clients.set(id, { id, controller, encoder });
    }

    public static removeClient(type: SSEType, id: string): void {
        this.sseStore[type].clients.delete(id);
    }

    private static broadcastEvent(type: SSEType, event: string, data: any): void {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of this.sseStore[type].clients.values()) {
            if (type === 'loop' && client.id !== data.chatKey) {
                continue;
            }
            try {
                client.controller.enqueue(client.encoder.encode(message));
            } catch (err) {
                this.removeClient(type, client.id);
                this.logger.error(`Failed to send to client ${client.id} for ${type}: ${err}`);
            }
        }
    }

    private static convertToSSEEvent(e: AgentInfoEvent | AgentStreamEvent): SSEEvent {
        if ('text' in e) {
            return {
                sseType: 'streamText',
                chatKey: e.chatKey,
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
