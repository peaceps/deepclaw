import { newLoopSSEEndpoint } from '../sse';

export async function GET(request: Request) {
    const url = new URL(request.url);
    if (!url.searchParams.has('loopId'))
        return Response.json({}, {status: 404});

    return newLoopSSEEndpoint(url.searchParams.get('loopId')!);
}
