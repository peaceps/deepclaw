import { newInfoSSEEndpoint } from '../sse';

export async function GET(request: Request) {
    const url = new URL(request.url);
    if (!url.searchParams.has('browserId')) return Response.json({}, {status: 404});

    return newInfoSSEEndpoint(url.searchParams.get('browserId')!);
}
