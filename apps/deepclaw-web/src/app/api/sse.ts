import crypto from 'crypto';
import { SSEServer } from "./sse-server";
import type { SSEType } from "@deepclaw/loop-gateway";

export function newSSEEndpoint(type: SSEType): Response {
    const encoder = new TextEncoder();
    const clientId = crypto.randomUUID();

    const stream = new ReadableStream({
        start(controller) {
            SSEServer.addClient(type, clientId, controller, encoder);
            controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`));
        },
        cancel() {
            SSEServer.removeClient(type, clientId);
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
