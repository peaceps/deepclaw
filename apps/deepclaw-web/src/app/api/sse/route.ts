import { newSSEEndpoint } from '../sse-endpoint';

export async function GET(request: Request) {
    const url = new URL(request.url);
    if (!url.searchParams.has('browserId')) return Response.json({}, {status: 404});

    return newSSEEndpoint(url.searchParams.get('browserId')!);
}
