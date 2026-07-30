import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newInfoSSEEndpoint, newLoopSSEEndpoint} from './sse';
import {type SSEType} from './sse-types';

const mocks = vi.hoisted(() => ({
    addClient: vi.fn<(
        type: SSEType, browserId: string, loopId: string | undefined,
        controller: ReadableStreamDefaultController, encoder: TextEncoder
    ) => void>(),
    removeClient: vi.fn<(type: SSEType, browserId: string, loopId?: string) => void>(),
}));

vi.mock('./sse-server', () => ({
    SSEServer: {addClient: mocks.addClient, removeClient: mocks.removeClient},
}));

const decoder = new TextDecoder();

async function readFrame(response: Response): Promise<string> {
    const reader = response.body!.getReader();
    const {value} = await reader.read();
    reader.releaseLock();
    return decoder.decode(value);
}

function registration(): {type: SSEType; browserId: string; loopId: string | undefined} {
    const [type, browserId, loopId] = mocks.addClient.mock.calls[0]!;
    return {type, browserId, loopId};
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('newInfoSSEEndpoint', () => {

    test('registers the browser as an info client without a loop', () => {
        newInfoSSEEndpoint('b1');
        expect(registration()).toEqual({type: 'info', browserId: 'b1', loopId: undefined});
    });

    test('answers with an uncached event stream that stays open', () => {
        const {headers} = newInfoSSEEndpoint('b1');
        expect(headers.get('Content-Type')).toBe('text/event-stream');
        expect(headers.get('Cache-Control')).toBe('no-cache');
        expect(headers.get('Connection')).toBe('keep-alive');
    });

    test('greets the client with its own browser id', async () => {
        const frame = await readFrame(newInfoSSEEndpoint('b1'));
        expect(frame).toBe(`event: connected\ndata: ${JSON.stringify({content: 'b1'})}\n\n`);
    });

    test('registers the client before the greeting is written', async () => {
        mocks.addClient.mockImplementation((_type, _browserId, _loopId, controller, encoder) => {
            controller.enqueue(encoder.encode('event: first\ndata: {}\n\n'));
        });
        const frame = await readFrame(newInfoSSEEndpoint('b1'));
        expect(frame).toBe('event: first\ndata: {}\n\n');
    });

    test('hands over a controller and an encoder that write into the answered stream', async () => {
        const response = newInfoSSEEndpoint('b1');
        const [, , , controller, encoder] = mocks.addClient.mock.calls[0]!;
        controller.enqueue(encoder.encode('event: busy\ndata: {}\n\n'));
        const reader = response.body!.getReader();
        await reader.read();
        const {value} = await reader.read();
        expect(decoder.decode(value)).toBe('event: busy\ndata: {}\n\n');
    });

    test('forgets the client when the browser drops the stream', async () => {
        const response = newInfoSSEEndpoint('b1');
        await response.body!.cancel();
        expect(mocks.removeClient).toHaveBeenCalledWith('info', 'b1', undefined);
    });

    test('does not forget the client while the stream is only being read', async () => {
        await readFrame(newInfoSSEEndpoint('b1'));
        expect(mocks.removeClient).not.toHaveBeenCalled();
    });

    test('greets an empty browser id as well', async () => {
        const frame = await readFrame(newInfoSSEEndpoint(''));
        expect(frame).toContain(JSON.stringify({content: ''}));
    });
});

describe('newLoopSSEEndpoint', () => {

    test('registers the browser as a loop client of the given loop', () => {
        newLoopSSEEndpoint('b1', 'agent.a1');
        expect(registration()).toEqual({type: 'loop', browserId: 'b1', loopId: 'agent.a1'});
    });

    test('greets the client with its browser id rather than its loop id', async () => {
        const frame = await readFrame(newLoopSSEEndpoint('b1', 'agent.a1'));
        expect(frame).toBe(`event: connected\ndata: ${JSON.stringify({content: 'b1'})}\n\n`);
    });

    test('answers with an event stream', () => {
        expect(newLoopSSEEndpoint('b1', 'agent.a1').headers.get('Content-Type')).toBe('text/event-stream');
    });

    test('forgets the client with its loop when the browser drops the stream', async () => {
        const response = newLoopSSEEndpoint('b1', 'agent.a1');
        await response.body!.cancel();
        expect(mocks.removeClient).toHaveBeenCalledWith('loop', 'b1', 'agent.a1');
    });

    test('gives every stream its own controller', () => {
        newLoopSSEEndpoint('b1', 'agent.a1');
        newLoopSSEEndpoint('b1', 'agent.a2');
        const [, , , first] = mocks.addClient.mock.calls[0]!;
        const [, , , second] = mocks.addClient.mock.calls[1]!;
        expect(first).not.toBe(second);
    });
});
