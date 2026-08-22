import { SSEServer } from "./sse-server";

export function newSSEEndpoint(browserId: string): Response {
    const encoder = new TextEncoder();
    let streamId = 0;

    const stream = new ReadableStream({
        start(controller) {
            streamId = SSEServer.addClient(browserId, controller, encoder);
            controller.enqueue(encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ content: browserId })}\n\n`
            ));
        },
        // This stream, not whatever stream the browser holds by now: a reload can be through before
        // the one it left behind is noticed to be over.
        cancel() {
            SSEServer.removeClient(browserId, streamId);
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
