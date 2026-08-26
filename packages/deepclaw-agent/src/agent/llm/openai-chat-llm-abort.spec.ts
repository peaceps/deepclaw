import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {newTestLogger} from '../../test-support/one-loop-context';
import {ToolsManager} from '../loop/services/tools-manager';
import {OpenAIChatLLM} from './openai-chat-llm';

/**
 * The one test here runs against the real sdk on purpose, with nothing of `openai` mocked, because
 * what it is about is how that sdk behaves when a stream of it is aborted rather than how we call
 * it: it catches the abort itself and closes the iterator without a word, which leaves a stopped
 * stream looking exactly like a model that answered nothing. A fake stream cannot tell us that,
 * and a fake stream is what every other test of this protocol has.
 */
let server: Server;

beforeEach(async () => {
    vi.spyOn(ToolsManager, 'getToolsArray').mockReturnValue([]);
    // Answers with half of a stream and then holds it open forever: the signal is the only thing
    // left that can end the call, which is the state a stop has to be safe in.
    server = createServer((_, res) => {
        res.writeHead(200, {'Content-Type': 'text/event-stream'});
        res.write(`data: ${JSON.stringify({
            id: '1', object: 'chat.completion.chunk', created: 0, model: 'gpt-test',
            choices: [{index: 0, delta: {content: 'half of an ans'}, finish_reason: null}],
        })}\n\n`);
    });
    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
});

afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => {
        server.close(() => resolve());
    });
    vi.restoreAllMocks();
});

function newLLM(): OpenAIChatLLM {
    const {port} = server.address() as AddressInfo;
    return new OpenAIChatLLM('main', 'agent', {
        baseURL: `http://127.0.0.1:${port}`, apiKey: 'key', model: 'gpt-test'
    });
}

test('gives a stream the sdk closed on an abort back as an abort, with the words it did send', async () => {
    const said: string[] = [];
    // Waited on inside the stream rather than around it: aborted any earlier and the request
    // itself is what the signal reaches, which is the case that was never in doubt.
    let streaming = () => undefined as void;
    const streamed = new Promise<void>(resolve => {
        streaming = resolve;
    });
    const controller = new AbortController();
    const call = newLLM().invoke(
        'agent', {cacheable: 'c', learned: 'l', dynamic: 'd'}, [{role: 'user', content: 'hi'}],
        text => {
            said.push(text);
            streaming();
        },
        newTestLogger(), controller.signal
    );
    await streamed;
    controller.abort();

    await expect(call).rejects.toSatisfy((error: Error) => error.name === 'AbortError');
    expect(said.join('')).toBe('half of an ans');
});
