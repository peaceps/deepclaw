import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newSSEEndpoint} from './sse-endpoint';

const mocks = vi.hoisted(() => ({
    addClient: vi.fn<(
        browserId: string, controller: ReadableStreamDefaultController, encoder: TextEncoder
    ) => void>(),
    removeClient: vi.fn<(browserId: string) => void>(),
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

beforeEach(() => {
    vi.resetAllMocks();
});

describe('newSSEEndpoint', () => {

    test('registers the browser as a client', () => {
        newSSEEndpoint('b1');
        expect(mocks.addClient.mock.calls[0]![0]).toBe('b1');
    });

    test('answers with an uncached event stream that stays open', () => {
        const {headers} = newSSEEndpoint('b1');
        expect(headers.get('Content-Type')).toBe('text/event-stream');
        expect(headers.get('Cache-Control')).toBe('no-cache');
        expect(headers.get('Connection')).toBe('keep-alive');
    });

    test('greets the client with its own browser id', async () => {
        const frame = await readFrame(newSSEEndpoint('b1'));
        expect(frame).toBe(`event: connected\ndata: ${JSON.stringify({content: 'b1'})}\n\n`);
    });

    test('registers the client before the greeting is written', async () => {
        mocks.addClient.mockImplementation((_browserId, controller, encoder) => {
            controller.enqueue(encoder.encode('event: first\ndata: {}\n\n'));
        });
        const frame = await readFrame(newSSEEndpoint('b1'));
        expect(frame).toBe('event: first\ndata: {}\n\n');
    });

    test('hands over a controller and an encoder that write into the answered stream', async () => {
        const response = newSSEEndpoint('b1');
        const [, controller, encoder] = mocks.addClient.mock.calls[0]!;
        controller.enqueue(encoder.encode('event: busy\ndata: {}\n\n'));
        const reader = response.body!.getReader();
        await reader.read();
        const {value} = await reader.read();
        expect(decoder.decode(value)).toBe('event: busy\ndata: {}\n\n');
    });

    test('forgets the client when the browser drops the stream', async () => {
        const response = newSSEEndpoint('b1');
        await response.body!.cancel();
        expect(mocks.removeClient).toHaveBeenCalledWith('b1');
    });

    test('does not forget the client while the stream is only being read', async () => {
        await readFrame(newSSEEndpoint('b1'));
        expect(mocks.removeClient).not.toHaveBeenCalled();
    });

    test('greets an empty browser id as well', async () => {
        const frame = await readFrame(newSSEEndpoint(''));
        expect(frame).toContain(JSON.stringify({content: ''}));
    });

    test('gives every stream its own controller', () => {
        newSSEEndpoint('b1');
        newSSEEndpoint('b2');
        const [, first] = mocks.addClient.mock.calls[0]!;
        const [, second] = mocks.addClient.mock.calls[1]!;
        expect(first).not.toBe(second);
    });
});
