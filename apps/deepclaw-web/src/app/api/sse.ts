import { SSEServer } from "./sse-server";
import type { SSEType } from "@deepclaw/loop-gateway";

export function newInfoSSEEndpoint(browserId: string): Response {
    return newSSEEndpoint('info', browserId);
}
export function newLoopSSEEndpoint(browserId: string, loopId: string): Response {
    return newSSEEndpoint('loop', browserId, loopId);
}

function newSSEEndpoint(type: SSEType, browserId: string, loopId?: string): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            SSEServer.addClient(type, browserId, loopId, controller, encoder);
            controller.enqueue(encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ content: browserId })}\n\n`
            ));
        },
        cancel() {
            SSEServer.removeClient(type, browserId, loopId);
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
