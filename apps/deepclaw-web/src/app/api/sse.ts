import { SSEServer } from "./sse-server";
import type { SSEType } from "@deepclaw/loop-gateway";

export function newInfoSSEEndpoint(id: string): Response {
    return newSSEEndpoint('info', id);
}
export function newLoopSSEEndpoint(id: string, loopId: string): Response {
    return newSSEEndpoint('loop', id, loopId);
}

function newSSEEndpoint(type: SSEType, id: string, loopId?: string): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            SSEServer.addClient(type, id, loopId, controller, encoder);
            controller.enqueue(encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ content: id })}\n\n`
            ));
        },
        cancel() {
            SSEServer.removeClient(type, id);
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
