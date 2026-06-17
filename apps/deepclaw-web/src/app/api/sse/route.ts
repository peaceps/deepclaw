import crypto from 'crypto';
import { SSEServer } from "./sse-server";

export async function GET(request: Request) {
    const url = new URL(request.url);
    if (url.searchParams.get('secret') !== 'sse') return Response.json({}, {status: 404});

    const encoder = new TextEncoder();
    const clientId = crypto.randomUUID();

    const stream = new ReadableStream({
        start(controller) {
            SSEServer.addClient(clientId, controller, encoder);
            controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`));
        },
        cancel() {
            SSEServer.removeClient(clientId);
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
