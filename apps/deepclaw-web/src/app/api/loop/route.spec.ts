import {beforeEach, describe, expect, test, vi} from 'vitest';
import {GET} from './route';

const mocks = vi.hoisted(() => ({
    newLoopSSEEndpoint: vi.fn<(browserId: string, loopId: string) => Response>(),
}));

vi.mock('../sse', () => ({newLoopSSEEndpoint: mocks.newLoopSSEEndpoint}));

let stream: Response;

function get(query: string): Promise<Response> {
    return GET(new Request(`http://localhost:3000/api/loop${query}`));
}

beforeEach(() => {
    vi.clearAllMocks();
    stream = new Response('stream');
    mocks.newLoopSSEEndpoint.mockReturnValue(stream);
});

describe('GET', () => {

    test('answers with the loop stream of the given browser and loop', async () => {
        expect(await get('?browserId=b1&loopId=agent.a1')).toBe(stream);
        expect(mocks.newLoopSSEEndpoint).toHaveBeenCalledWith('b1', 'agent.a1');
    });

    test('answers 404 with an empty body when the browser id is missing', async () => {
        const response = await get('?loopId=agent.a1');
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({});
        expect(mocks.newLoopSSEEndpoint).not.toHaveBeenCalled();
    });

    test('answers 404 when the loop id is missing', async () => {
        expect((await get('?browserId=b1')).status).toBe(404);
        expect(mocks.newLoopSSEEndpoint).not.toHaveBeenCalled();
    });

    test('answers 404 when there is no query at all', async () => {
        expect((await get('')).status).toBe(404);
    });

    test('takes an empty browser id as a named browser', async () => {
        expect(await get('?browserId=&loopId=agent.a1')).toBe(stream);
        expect(mocks.newLoopSSEEndpoint).toHaveBeenCalledWith('', 'agent.a1');
    });

    test('takes an empty loop id as a named loop', async () => {
        expect(await get('?browserId=b1&loopId=')).toBe(stream);
        expect(mocks.newLoopSSEEndpoint).toHaveBeenCalledWith('b1', '');
    });

    test('reads the ids in whatever order they arrive', async () => {
        await get('?loopId=project.a1.p1&browserId=b1');
        expect(mocks.newLoopSSEEndpoint).toHaveBeenCalledWith('b1', 'project.a1.p1');
    });
});
