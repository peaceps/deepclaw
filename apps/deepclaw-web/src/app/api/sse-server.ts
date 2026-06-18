import { LoopGateway, type SSEType } from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import type { AgentEmployee, AgentInfoEvent, Project, Task } from "@deepclaw/core";

export type SSEEvent = {
    sseType: string;
    content: any;
}

export type SSEInfoEvent = SSEEvent & ({
    sseType: 'updateProject'
    content: Project<Task>
} | {
    sseType: 'updateAgent'
    content: Partial<AgentEmployee> & {id: string}
});

export type SSELoopStreamEvent = SSEEvent & ({
    sseType: 'streamText'
    content: string
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
            store.unsubscriber = LoopGateway.subscribe(type, (e: AgentInfoEvent | string) => {
                const sseEvent = this.convertToSSEEvent(e);
                this.broadcastEvent(type, sseEvent.sseType, {content: sseEvent.content});
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
            try {
                client.controller.enqueue(client.encoder.encode(message));
            } catch (err) {
                this.removeClient(type, client.id);
                this.logger.error(`Failed to send to client ${client.id} for ${type}: ${err}`);
            }
        }
    }

    private static convertToSSEEvent(e: AgentInfoEvent | string): SSEEvent {
        if (typeof e === 'string') {
            return {
                sseType: 'streamText',
                content: e
            };
        }
        return {
            sseType: e.type,
            content: e.content
        };
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
