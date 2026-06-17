import { LoopGateway } from "@deepclaw/loop-gateway";
import { AgentInfoEvent } from "@deepclaw/core";

type SSEClient = {
    id: string;
    controller: ReadableStreamDefaultController;
    encoder: TextEncoder;
}

export class SSEServer {
    // TODO
    private static logger = console;
    private static clients: Map<string, SSEClient> = new Map();

    static {
        LoopGateway.subscribe((e: AgentInfoEvent) => {
            this.broadcastEvent(e.type, {content: e.content});
        });
    }

    public static addClient(id: string, controller: ReadableStreamDefaultController, encoder: TextEncoder) {
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
                this.logger.error(`Failed to send to client ${client.id}: ${err}`);
            }
        }
    }
}
