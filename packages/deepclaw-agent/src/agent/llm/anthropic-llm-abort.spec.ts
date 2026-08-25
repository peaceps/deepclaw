import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {APIUserAbortError} from '@anthropic-ai/sdk';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {newTestLogger} from '../../test-support/one-loop-context';
import {ToolsManager} from '../loop/services/tools-manager';
import {AnthropicLLM} from './anthropic-llm';

/**
 * The one test here runs against the real sdk on purpose, with nothing of `@anthropic-ai/sdk`
 * mocked, because what it is about is how that sdk behaves when a call of it is aborted rather
 * than how we call it. A stream tears an abort down through an event of its own, and one that
 * nobody is listening for is rejected into the void: Node answers an unhandled rejection by
 * ending the process, so getting this wrong turns pressing stop into the server going down.
 * A fake stream cannot tell us anything about that, and this is the only kind of stub that can.
 */
let server: Server;
let requestArrived: Promise<void>;
let rejections: unknown[];

function collect(reason: unknown): void {
    rejections.push(reason);
}

beforeEach(async () => {
    vi.spyOn(ToolsManager, 'getToolsArray').mockReturnValue([]);
    rejections = [];
    process.on('unhandledRejection', collect);
    // Takes the request and answers nothing, ever: the signal is then the only thing that can end
    // the call, which is the state a stop has to be safe in.
    let arrived = () => undefined as void;
    requestArrived = new Promise<void>(resolve => {
        arrived = resolve;
    });
    server = createServer(() => arrived());
    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
});

afterEach(async () => {
    process.off('unhandledRejection', collect);
    server.closeAllConnections();
    await new Promise<void>(resolve => {
        server.close(() => resolve());
    });
    vi.restoreAllMocks();
});

function newLLM(): AnthropicLLM {
    const {port} = server.address() as AddressInfo;
    return new AnthropicLLM('main', 'agent', {
        baseURL: `http://127.0.0.1:${port}`, apiKey: 'key', model: 'sonnet'
    });
}

test('gives an aborted stream back as an abort, with nothing rejected where nobody is looking', async () => {
    const controller = new AbortController();
    const call = newLLM().invoke(
        'agent', {cacheable: 'c', learned: 'l', dynamic: 'd'}, [{role: 'user', content: 'hi'}],
        () => undefined, newTestLogger(), controller.signal
    );
    await requestArrived;
    controller.abort();

    await expect(call).rejects.toBeInstanceOf(APIUserAbortError);
    // An unhandled rejection is reported a turn of the event loop after the one that made it.
    await new Promise(resolve => setImmediate(resolve));
    expect(rejections).toEqual([]);
});
