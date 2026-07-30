import {beforeEach, describe, expect, test, vi} from 'vitest';
import {GET} from './route';

const mocks = vi.hoisted(() => ({
    newInfoSSEEndpoint: vi.fn<(browserId: string) => Response>(),
}));

vi.mock('../sse', () => ({newInfoSSEEndpoint: mocks.newInfoSSEEndpoint}));

let stream: Response;

function get(query: string): Promise<Response> {
    return GET(new Request(`http://localhost:3000/api/info${query}`));
}

beforeEach(() => {
    vi.clearAllMocks();
    stream = new Response('stream');
    mocks.newInfoSSEEndpoint.mockReturnValue(stream);
});

describe('GET', () => {

    test('answers with the info stream of the given browser', async () => {
        expect(await get('?browserId=b1')).toBe(stream);
        expect(mocks.newInfoSSEEndpoint).toHaveBeenCalledWith('b1');
    });

    test('answers 404 with an empty body when the browser id is missing', async () => {
        const response = await get('');
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({});
        expect(mocks.newInfoSSEEndpoint).not.toHaveBeenCalled();
    });

    test('ignores query parameters that are not the browser id', async () => {
        const response = await get('?loopId=agent.a1');
        expect(response.status).toBe(404);
    });

    test('takes an empty browser id as a named browser', async () => {
        expect(await get('?browserId=')).toBe(stream);
        expect(mocks.newInfoSSEEndpoint).toHaveBeenCalledWith('');
    });

    test('keeps the first browser id when it is given twice', async () => {
        await get('?browserId=b1&browserId=b2');
        expect(mocks.newInfoSSEEndpoint).toHaveBeenCalledWith('b1');
    });

    test('decodes an escaped browser id', async () => {
        await get('?browserId=b%201');
        expect(mocks.newInfoSSEEndpoint).toHaveBeenCalledWith('b 1');
    });
});
