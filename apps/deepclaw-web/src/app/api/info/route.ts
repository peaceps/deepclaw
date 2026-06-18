import { newSSEEndpoint } from '../sse';

export async function GET(request: Request) {
    const url = new URL(request.url);
    if (url.searchParams.get('secret') !== 'info') return Response.json({}, {status: 404});

    return newSSEEndpoint('info');
}
