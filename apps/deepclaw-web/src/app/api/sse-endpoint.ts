import { SSEServer } from "./sse-server";

export function newSSEEndpoint(browserId: string): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            SSEServer.addClient(browserId, controller, encoder);
            controller.enqueue(encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ content: browserId })}\n\n`
            ));
        },
        cancel() {
            SSEServer.removeClient(browserId);
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
