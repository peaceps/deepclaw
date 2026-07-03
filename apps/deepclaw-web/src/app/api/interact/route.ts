import { LoopGateway } from "@deepclaw/loop-gateway";

export async function POST(request: Request) {
    const body = await request.json() as { loopId?: string; clientId?: string; answer?: string };
    const { loopId, clientId, answer } = body;

    if (!loopId || !clientId || answer === undefined) {
        return Response.json({ error: 'loopId and answer are required' }, { status: 400 });
    }

    const resolved = LoopGateway.resolveInteraction(loopId, clientId, answer);
    if (!resolved) {
        return Response.json({ error: 'No waiting interaction for this loop' }, { status: 404 });
    }

    return Response.json({ ok: true });
}
