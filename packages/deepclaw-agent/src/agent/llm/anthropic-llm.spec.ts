import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {ToolUnion} from '@anthropic-ai/sdk/resources.js';
import type {LLMTransitionReason} from '@deepclaw/core';
import type {LLMTool} from '../definitions/tool-definitions';
import {newTestLogger} from '../../test-support/one-loop-context';
import {ToolsManager} from '../loop/services/tools-manager';
import {AnthropicLLM, type ThinkingMessage, type ThinkingResponse} from './anthropic-llm';

const mocks = vi.hoisted(() => ({
    newClient: vi.fn<(options: unknown) => void>(() => undefined),
    stream: vi.fn(),
    readImage: vi.fn<(key: string) => Buffer | null>(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        public messages = {stream: mocks.stream};
        constructor(options: unknown) {
            mocks.newClient(options);
        }
    },
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    ImageStore: {read: mocks.readImage},
}));

const getToolsArray = vi.spyOn(ToolsManager, 'getToolsArray');

class TestableAnthropicLLM extends AnthropicLLM {

    public tools(tools: LLMTool[]): ToolUnion[] {
        return this.convertTools(tools);
    }

    public build(content: string, transitionReason?: LLMTransitionReason): ThinkingResponse {
        return this.newResponse(content, transitionReason);
    }

    public messagesOf(response: ThinkingResponse): ThinkingMessage[] {
        return this.convertResponseToMessages(response);
    }

    public textOf(response: ThinkingResponse): string {
        return this.getTextFromResponse(response);
    }
}

function newLLM(): TestableAnthropicLLM {
    return new TestableAnthropicLLM('main', {
        baseURL: 'https://api.anthropic.example.com', apiKey: 'key', model: 'sonnet'
    });
}

function newTool(name: string): LLMTool {
    return {name, description: `${name} tool`, schema: {type: 'object', properties: {a: {type: 'string'}}}};
}

function newResponse(overrides: Partial<ThinkingResponse> = {}): ThinkingResponse {
    return {
        transitionReason: 'endLoop',
        id: 'msg_1',
        container: null,
        model: 'sonnet',
        stop_details: null,
        stop_reason: 'end_turn',
        stop_sequence: null,
        role: 'assistant',
        content: [{type: 'text', text: 'hello', citations: []}],
        type: 'message',
        usage: {
            cache_creation: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            inference_geo: null,
            server_tool_use: null,
            service_tier: null,
            input_tokens: 0,
            output_tokens: 0,
        },
        ...overrides,
    } as ThinkingResponse;
}

type FakeStream = {
    on: (event: string, listener: (text: string) => void) => FakeStream;
    finalMessage: () => Promise<ThinkingResponse>;
};

function newStream(final: ThinkingResponse, texts: string[] = []): FakeStream {
    const stream: FakeStream = {
        on: (event, listener) => {
            if (event === 'text') {
                texts.forEach(text => listener(text));
            }
            return stream;
        },
        finalMessage: async () => final,
    };
    return stream;
}

/** The retry path sleeps 500ms between attempts, so the timers are driven by hand. */
async function runWithoutWaiting<T>(start: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    try {
        const pending = start();
        await vi.advanceTimersByTimeAsync(5000);
        return await pending;
    } finally {
        vi.useRealTimers();
    }
}

function invoke(llm: AnthropicLLM, messages: ThinkingMessage[] = []): Promise<ThinkingResponse> {
    return llm.invoke(
        'agent', {cacheable: 'cacheable prompt', learned: 'learned prompt', dynamic: 'dynamic prompt'},
        messages, () => undefined, newTestLogger()
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    getToolsArray.mockReturnValue([]);
    mocks.stream.mockReturnValue(newStream(newResponse()));
});

describe('AnthropicLLM convertTools', () => {

    test('renames the tool schema to the anthropic input schema', () => {
        expect(newLLM().tools([newTool('read_file')])).toEqual([{
            name: 'read_file',
            description: 'read_file tool',
            input_schema: {type: 'object', properties: {a: {type: 'string'}}},
        }]);
    });

    test('returns nothing when there is no tool at all', () => {
        expect(newLLM().tools([])).toEqual([]);
    });
});

describe('AnthropicLLM createLLMClient', () => {

    test('builds the sdk client with the base url, api key and timeout', () => {
        newLLM();
        expect(mocks.newClient).toHaveBeenCalledExactlyOnceWith({
            baseURL: 'https://api.anthropic.example.com', apiKey: 'key', timeout: 300000
        });
    });
});

/** How many breakpoints the call asked for on the history, wherever they landed in it. */
function cacheMarks(): number {
    const sent = (mocks.stream.mock.calls[0]![0] as {messages: ThinkingMessage[]}).messages;
    return sent
        .flatMap(message => typeof message.content === 'string' ? [] : message.content)
        .filter(block => !!block.cache_control).length;
}

describe('AnthropicLLM request', () => {

    test('caches the stable prompt and what was learned under a breakpoint each', async () => {
        await invoke(newLLM());
        expect(mocks.stream.mock.calls[0]![0]).toMatchObject({
            system: [
                {type: 'text', text: 'cacheable prompt', cache_control: {type: 'ephemeral'}},
                {type: 'text', text: 'learned prompt', cache_control: {type: 'ephemeral'}},
                {type: 'text', text: 'dynamic prompt'},
            ],
        });
    });

    test('leaves out a piece of the system prompt that says nothing', async () => {
        await newLLM().invoke(
            'agent', {cacheable: 'cacheable prompt', learned: '', dynamic: ' '},
            [], () => undefined, newTestLogger()
        );
        expect(mocks.stream.mock.calls[0]![0]!.system).toEqual([
            {type: 'text', text: 'cacheable prompt', cache_control: {type: 'ephemeral'}},
        ]);
    });

    test('marks the end of the history, so the next call reads it from the cache', async () => {
        await invoke(newLLM(), [
            {role: 'user', content: 'hi'},
            {role: 'assistant', content: [{type: 'text', text: 'first'}, {type: 'text', text: 'last'}]},
        ]);
        expect(mocks.stream.mock.calls[0]![0]!.messages).toEqual([
            {role: 'user', content: 'hi'},
            {role: 'assistant', content: [
                {type: 'text', text: 'first'},
                {type: 'text', text: 'last', cache_control: {type: 'ephemeral'}},
            ]},
        ]);
    });

    test('marks the plain text of a message as the block it goes over as', async () => {
        await invoke(newLLM(), [{role: 'user', content: 'hi'}]);
        expect(mocks.stream.mock.calls[0]![0]!.messages).toEqual([
            {role: 'user', content: [{type: 'text', text: 'hi', cache_control: {type: 'ephemeral'}}]},
        ]);
    });

    test.for([
        ['no history at all', [] as ThinkingMessage[]],
        ['a last message that says nothing', [{role: 'user', content: ''}] as ThinkingMessage[]],
    ] as const)('marks nothing on %s', async ([, messages]) => {
        await invoke(newLLM(), [...messages]);
        expect(cacheMarks()).toBe(0);
    });

    test('sends the model, the history, the tools and the gateway limits', async () => {
        getToolsArray.mockReturnValue([newTool('read_file')]);
        const messages: ThinkingMessage[] = [{role: 'user', content: 'hi'}];
        await invoke(newLLM(), messages);
        expect(mocks.stream.mock.calls[0]![0]).toMatchObject({
            model: 'sonnet',
            max_tokens: 8000,
            temperature: 0.1,
            tools: [{name: 'read_file', description: 'read_file tool', input_schema: {type: 'object', properties: {a: {type: 'string'}}}}],
        });
    });

    test('forwards every streamed text fragment to the streamer', async () => {
        mocks.stream.mockReturnValue(newStream(newResponse(), ['he', 'llo']));
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        await newLLM().invoke(
            'agent', {cacheable: 'c', learned: 'l', dynamic: 'd'}, [], streamer, newTestLogger()
        );
        expect(streamer.mock.calls).toEqual([['he'], ['llo']]);
    });
});

describe('AnthropicLLM image references', () => {

    function withImage(url: string): ThinkingMessage[] {
        return [newLLM().newImageInputMessage('look', [{url}])];
    }

    function sentContent(): unknown[] {
        return (mocks.stream.mock.calls[0]![0] as {messages: {content: unknown[]}[]}).messages[0]!.content;
    }

    test('keeps the reference in the history and sends the bytes it points at', async () => {
        mocks.readImage.mockReturnValue(Buffer.from('the image'));
        const messages = withImage('dcimg://abc123.png');
        await invoke(newLLM(), messages);
        expect(mocks.readImage).toHaveBeenCalledWith('abc123.png');
        expect(sentContent()[1]).toMatchObject({
            type: 'image',
            source: {type: 'base64', media_type: 'image/png', data: Buffer.from('the image').toString('base64')},
        });
        expect(messages[0]!.content[1]).toEqual({type: 'image', source: {type: 'url', url: 'dcimg://abc123.png'}});
    });

    test('tells the model about an image whose bytes are gone', async () => {
        mocks.readImage.mockReturnValue(null);
        await invoke(newLLM(), withImage('dcimg://abc123.png'));
        expect(sentContent()[1]).toMatchObject({type: 'text', text: '[image unavailable, its bytes are gone]'});
    });

    test('drops an image of a type the model does not take', async () => {
        mocks.readImage.mockReturnValue(Buffer.from('the image'));
        await invoke(newLLM(), withImage('dcimg://abc123.bin'));
        expect(sentContent()[1]).toMatchObject({
            type: 'text', text: '[image dropped, unsupported type application/octet-stream]'
        });
    });

    /**
     * The history is what the next call is built from, so neither the bytes of an image nor the
     * breakpoint of this call may be left in it: a mark sent again would spend a breakpoint on a
     * turn that has one behind it already.
     */
    test('leaves the history it was given as it found it', async () => {
        const messages: ThinkingMessage[] = [{role: 'user', content: 'hi'}];
        await invoke(newLLM(), messages);
        expect(messages[0]).toEqual({role: 'user', content: 'hi'});
        expect(mocks.readImage).not.toHaveBeenCalled();
    });
});

describe('AnthropicLLM transition reason', () => {

    test.for([
        ['tool_use', 'toolUse'],
        ['max_tokens', 'maxTokens'],
        ['refusal', 'refused'],
        ['end_turn', 'endLoop'],
        ['stop_sequence', 'endLoop'],
        ['pause_turn', 'endLoop'],
    ] as const)('turns the %s stop reason into %s', async ([stopReason, expected]) => {
        mocks.stream.mockReturnValue(newStream(newResponse({stop_reason: stopReason})));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe(expected);
    });
});

describe('AnthropicLLM convertResponseToMessages', () => {

    test('keeps the whole response content as one assistant message', () => {
        const llm = newLLM();
        const response = newResponse({content: [
            {type: 'text', text: 'let me look', citations: []},
            {type: 'tool_use', id: 'tu1', name: 'read_file', input: {path: 'a.txt'}, caller: {type: 'direct'}},
        ]});
        expect(llm.messagesOf(response)).toEqual([{role: 'assistant', content: response.content}]);
    });

    test('appends the assistant message to the history during an invoke', async () => {
        const messages: ThinkingMessage[] = [{role: 'user', content: 'hi'}];
        await invoke(newLLM(), messages);
        expect(messages).toEqual([
            {role: 'user', content: 'hi'},
            {role: 'assistant', content: [{type: 'text', text: 'hello', citations: []}]},
        ]);
    });
});

describe('AnthropicLLM newResponse', () => {

    test('wraps the text in a single assistant text block', () => {
        const response = newLLM().build('something went wrong');
        expect(response.content).toEqual([{type: 'text', text: 'something went wrong', citations: []}]);
        expect(response.role).toBe('assistant');
        expect(response.model).toBe('sonnet');
    });

    test('ends the loop unless another reason is given', () => {
        expect(newLLM().build('bye').transitionReason).toBe('endLoop');
        expect(newLLM().build('bye', 'maxTokens').transitionReason).toBe('maxTokens');
    });

    test('reports no token usage', () => {
        expect(newLLM().getTokenUsage(newLLM().build('bye')))
            .toEqual({cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0});
    });

    test('gives every synthetic response its own id', () => {
        const llm = newLLM();
        expect(llm.build('a').id).not.toBe(llm.build('b').id);
    });
});

describe('AnthropicLLM getTextFromResponse', () => {

    test('joins the text blocks and ignores the tool calls', () => {
        expect(newLLM().textOf(newResponse({content: [
            {type: 'text', text: 'first', citations: []},
            {type: 'tool_use', id: 'tu1', name: 'read_file', input: {}, caller: {type: 'direct'}},
            {type: 'text', text: 'second', citations: []},
        ]}))).toBe('first\nsecond');
    });

    test('returns nothing when the response only calls tools', () => {
        expect(newLLM().textOf(newResponse({content: [
            {type: 'tool_use', id: 'tu1', name: 'read_file', input: {}, caller: {type: 'direct'}},
        ]}))).toBe('');
    });
});

describe('AnthropicLLM getTextFromInputMessage', () => {

    test('returns a plain string content as it is', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: 'plain'})).toBe('plain');
    });

    test('joins the text blocks of a block content', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: [
            {type: 'text', text: 'first'},
            {type: 'tool_result', tool_use_id: 'tu1', content: 'result'},
            {type: 'text', text: 'second'},
        ]})).toBe('first\nsecond');
    });

    test('keeps an empty slot for a text block without text', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: [
            {type: 'text', text: ''},
            {type: 'text', text: 'second'},
        ]})).toBe('\nsecond');
    });
});

describe('AnthropicLLM getTokenUsage', () => {

    test('counts the cache creation tokens as uncached input', () => {
        expect(newLLM().getTokenUsage(newResponse({usage: {
            cache_creation: null,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 200,
            inference_geo: null,
            server_tool_use: null,
            service_tier: null,
            input_tokens: 70,
            output_tokens: 12,
        }}))).toEqual({cachedInputTokens: 200, noCachedInputTokens: 100, outputTokens: 12});
    });

    test('treats missing cache counters as zero', () => {
        expect(newLLM().getTokenUsage(newResponse({usage: {
            cache_creation: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            inference_geo: null,
            server_tool_use: null,
            service_tier: null,
            input_tokens: 5,
            output_tokens: 6,
        }}))).toEqual({cachedInputTokens: 0, noCachedInputTokens: 5, outputTokens: 6});
    });
});

describe('AnthropicLLM isInputExceedLimit', () => {

    test('recognises a too large prompt and reports it as inputMaxTokens', async () => {
        mocks.stream.mockImplementation(() => {
            throw {status: 400, type: 'invalid_request_error', message: 'prompt is too large'};
        });
        const response = await runWithoutWaiting(() => invoke(newLLM()));
        expect(response.transitionReason).toBe('inputMaxTokens');
    });

    test('matches the size complaint regardless of case', async () => {
        mocks.stream.mockImplementation(() => {
            throw {status: 400, type: 'invalid_request_error', message: 'Request is TOO LARGE'};
        });
        const response = await runWithoutWaiting(() => invoke(newLLM()));
        expect(response.transitionReason).toBe('inputMaxTokens');
    });

    test('treats any other bad request as an unrecoverable error', async () => {
        mocks.stream.mockImplementation(() => {
            throw {status: 400, type: 'invalid_request_error', message: 'bad tool schema'};
        });
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('error');
        expect(newLLM().textOf(response)).toBe('ERROR: Unrecoverable error: bad tool schema.');
    });

    test('only reads the type off the top level of the error', async () => {
        mocks.stream.mockImplementation(() => {
            throw {status: 400, error: {type: 'invalid_request_error', message: 'prompt is too large'}};
        });
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('error');
        expect(newLLM().textOf(response)).toBe('ERROR: Unrecoverable error: 400.');
    });

    test('recognises the wording anthropic uses for an oversized prompt', async () => {
        mocks.stream.mockImplementation(() => {
            throw {
                status: 400, type: 'invalid_request_error',
                message: 'prompt is too long: 200000 tokens > 199999 maximum',
            };
        });
        const response = await runWithoutWaiting(() => invoke(newLLM()));
        expect(response.transitionReason).toBe('inputMaxTokens');
    });

    test('recognises a request that exceeds the context limit together with max tokens', async () => {
        mocks.stream.mockImplementation(() => {
            throw {
                status: 400, type: 'invalid_request_error',
                message: 'input length and `max_tokens` exceed context limit: 100 + 200 > 250',
            };
        });
        const response = await runWithoutWaiting(() => invoke(newLLM()));
        expect(response.transitionReason).toBe('inputMaxTokens');
    });

    test('reports a bad request without a message as an unrecoverable error', async () => {
        mocks.stream.mockImplementation(() => {
            throw {status: 400, type: 'invalid_request_error'};
        });
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('error');
        expect(newLLM().textOf(response)).toBe('ERROR: Unrecoverable error: 400.');
    });
});
