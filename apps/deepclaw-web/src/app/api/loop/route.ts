import { newSSEEndpoint } from '../sse';

export async function GET(request: Request) {
    const url = new URL(request.url);
    if (!url.searchParams.has('agentId') || !url.searchParams.has('projectId')) return Response.json({}, {status: 404});

    return newSSEEndpoint('loop', `${url.searchParams.get('agentId')}.${url.searchParams.get('projectId')}`);
}
