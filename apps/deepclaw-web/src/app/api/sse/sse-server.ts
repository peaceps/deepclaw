import { LoopGateway } from "@deepclaw/loop-gateway";
import { AgentInfoEvent } from "@deepclaw/core";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";

type SSEClient = {
    id: string;
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
}

class SSEServerImpl {
    // TODO
    private static logger = getLogger('SSEServer');
    private static clients: Map<string, SSEClient> = new Map();
    private static unsubscriber?: () => void;

    public static addClient(id: string, controller: ReadableStreamDefaultController, encoder: TextEncoder) {
        if (!this.unsubscriber) {
            this.unsubscriber = LoopGateway.subscribe((e: AgentInfoEvent) => {
                this.broadcastEvent(e.type, {content: e.content});
            });
        }
        this.clients.set(id, { id, controller, encoder });
    }

    public static removeClient(id: string) {
        this.clients.delete(id);
    }

    private static broadcastEvent(event: string, data: any) {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of this.clients.values()) {
            try {
                client.controller.enqueue(client.encoder.encode(message));
            } catch (err) {
                this.removeClient(client.id);
                this.logger.error(`Failed to send to client ${client.id}: ${err}`);
            }
        }
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
