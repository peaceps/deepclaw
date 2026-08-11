import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {ChatCompletionTool} from 'openai/resources/chat/completions.js';
import type {LLMTransitionReason} from '@deepclaw/core';
import type {LLMTool} from '../definitions/tool-definitions';
import {newTestLogger} from '../../test-support/one-loop-context';
import {ToolsManager} from '../loop/services/tools-manager';
import {OpenAIChatLLM, type ThinkingMessage, type ThinkingResponse} from './openai-chat-llm';

const mocks = vi.hoisted(() => ({
    newClient: vi.fn<(options: unknown) => void>(() => undefined),
    create: vi.fn(),
    readImage: vi.fn<(key: string) => Buffer | null>(),
}));

vi.mock('openai', () => {
    class FakeOpenAI {
        public chat = {completions: {create: mocks.create}};
        constructor(options: unknown) {
            mocks.newClient(options);
        }
    }
    return {default: FakeOpenAI, OpenAI: FakeOpenAI};
});

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    ImageStore: {read: mocks.readImage},
}));

const getToolsArray = vi.spyOn(ToolsManager, 'getToolsArray');

class TestableOpenAIChatLLM extends OpenAIChatLLM {

    public tools(tools: LLMTool[]): ChatCompletionTool[] {
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

type FakeDelta = {
    content?: string | null;
    reasoning_content?: string;
    tool_calls?: {
        index?: number; id?: string; type?: string; function?: {name?: string; arguments?: string};
    }[];
};

function newChunk(delta: FakeDelta | null, finishReason: string | null = null): unknown {
    const choice = delta === null ? {index: 0, finish_reason: finishReason}
        : {index: 0, delta, finish_reason: finishReason};
    return {choices: [choice]};
}

function newStream(chunks: unknown[]): AsyncIterable<unknown> {
    return {
        async* [Symbol.asyncIterator]() {
            for (const chunk of chunks) {
                yield chunk;
            }
        },
    };
}

function newLLM(): TestableOpenAIChatLLM {
    return new TestableOpenAIChatLLM(false, {
        baseURL: 'https://api.openai.example.com', apiKey: 'key', model: 'gpt-test'
    });
}

function newTool(name: string): LLMTool {
    return {name, description: `${name} tool`, schema: {type: 'object', properties: {a: {type: 'string'}}}};
}

function toolCallsOf(messages: ThinkingMessage[]): unknown {
    return (messages[0] as unknown as Record<string, unknown>)['tool_calls'];
}

function invoke(
    llm: OpenAIChatLLM,
    messages: ThinkingMessage[] = [],
    streamer: (text: string) => void = () => undefined
): Promise<ThinkingResponse> {
    return llm.invoke(
        'agent', {cacheable: 'cacheable prompt', dynamic: 'dynamic prompt'},
        messages, streamer, newTestLogger()
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    getToolsArray.mockReturnValue([]);
    mocks.create.mockReturnValue(newStream([newChunk({content: 'hello'}, 'stop')]));
});

describe('OpenAIChatLLM convertTools', () => {

    test('wraps every tool as a function tool with its schema as parameters', () => {
        expect(newLLM().tools([newTool('read_file')])).toEqual([{
            type: 'function',
            function: {
                name: 'read_file',
                description: 'read_file tool',
                parameters: {type: 'object', properties: {a: {type: 'string'}}},
            },
        }]);
    });

    test('returns nothing when there is no tool at all', () => {
        expect(newLLM().tools([])).toEqual([]);
    });
});

describe('OpenAIChatLLM image references', () => {

    function sentContent(): unknown[] {
        const sent = mocks.create.mock.calls[0]![0] as {messages: {content: unknown[]}[]};
        return sent.messages.find(message => Array.isArray(message.content))!.content;
    }

    test('sends the bytes the reference points at as a data url', async () => {
        mocks.readImage.mockReturnValue(Buffer.from('ABC'));
        const messages = [newLLM().newImageInputMessage('look', [{url: 'dcimg://abc123.png'}])];
        await invoke(newLLM(), messages);
        expect(sentContent()[1]).toEqual({
            type: 'image_url', image_url: {url: `data:image/png;base64,${Buffer.from('ABC').toString('base64')}`},
        });
        expect(messages[0]!.content![1]).toEqual({type: 'image_url', image_url: {url: 'dcimg://abc123.png'}});
    });

    test('tells the model about an image whose bytes are gone', async () => {
        mocks.readImage.mockReturnValue(null);
        await invoke(newLLM(), [newLLM().newImageInputMessage('look', [{url: 'dcimg://abc123.png'}])]);
        expect(sentContent()[1]).toEqual({type: 'text', text: '[image unavailable, its bytes are gone]'});
    });
});

describe('OpenAIChatLLM createLLMClient', () => {

    test('builds the sdk client with the base url, api key and timeout', () => {
        newLLM();
        expect(mocks.newClient).toHaveBeenCalledExactlyOnceWith({
            baseURL: 'https://api.openai.example.com', apiKey: 'key', timeout: 300000
        });
    });
});

describe('OpenAIChatLLM system prompt', () => {

    test('prepends the joined system prompt to a history that has none', async () => {
        const messages: ThinkingMessage[] = [{role: 'user', content: 'hi'}];
        await invoke(newLLM(), messages);
        expect(messages[0]).toEqual({role: 'system', content: 'cacheable prompt\ndynamic prompt'});
    });

    test('overwrites the existing system message instead of adding another one', async () => {
        const messages: ThinkingMessage[] = [
            {role: 'system', content: 'stale prompt'}, {role: 'user', content: 'hi'}
        ];
        await invoke(newLLM(), messages);
        expect(messages.filter(message => message.role === 'system')).toEqual([
            {role: 'system', content: 'cacheable prompt\ndynamic prompt'}
        ]);
    });

    test('sends the model, the gateway limits, the tools and the streaming options', async () => {
        getToolsArray.mockReturnValue([newTool('read_file')]);
        await invoke(newLLM());
        expect(mocks.create.mock.calls[0]![0]).toMatchObject({
            model: 'gpt-test',
            max_tokens: 8000,
            temperature: 0.1,
            tool_choice: 'auto',
            stream: true,
            stream_options: {include_usage: true},
            tools: [{type: 'function', function: {name: 'read_file'}}],
        });
    });
});

describe('OpenAIChatLLM streaming', () => {

    test('joins the content deltas and streams every fragment', async () => {
        mocks.create.mockReturnValue(newStream([
            newChunk({content: 'he'}), newChunk({content: 'llo'}), newChunk({content: ''}, 'stop'),
        ]));
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        const response = await invoke(newLLM(), [], streamer);
        expect(streamer.mock.calls).toEqual([['he'], ['llo']]);
        expect(newLLM().textOf(response)).toBe('hello');
    });

    test('joins the reasoning deltas without streaming them', async () => {
        mocks.create.mockReturnValue(newStream([
            newChunk({reasoning_content: 'thin'}), newChunk({reasoning_content: 'king'}),
            newChunk({content: 'answer'}, 'stop'),
        ]));
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        const response = await invoke(newLLM(), [], streamer);
        expect(response.delta.reasoning_content).toBe('thinking');
        expect(streamer.mock.calls).toEqual([['answer']]);
    });

    test('assembles the fragments of a tool call into one call', async () => {
        mocks.create.mockReturnValue(newStream([
            newChunk({tool_calls: [{index: 0, id: 'call_1', type: 'function', function: {name: 'read_file'}}]}),
            newChunk({tool_calls: [{index: 0, function: {arguments: '{"path":'}}]}),
            newChunk({tool_calls: [{index: 0, function: {arguments: '"a.txt"}'}}]}),
            newChunk({}, 'tool_calls'),
        ]));
        const response = await invoke(newLLM());
        expect(response.delta.tool_calls).toEqual([{
            index: 0, id: 'call_1', type: 'function',
            function: {name: 'read_file', arguments: '{"path":"a.txt"}'},
        }]);
    });

    test('orders parallel tool calls by their index', async () => {
        mocks.create.mockReturnValue(newStream([
            newChunk({tool_calls: [{index: 1, id: 'call_2', function: {name: 'write_file', arguments: '{}'}}]}),
            newChunk({tool_calls: [{index: 0, id: 'call_1', function: {name: 'read_file', arguments: '{}'}}]}),
            newChunk({}, 'tool_calls'),
        ]));
        const response = await invoke(newLLM());
        expect(response.delta.tool_calls?.map(toolCall => toolCall.id)).toEqual(['call_1', 'call_2']);
    });

    test('treats a tool call fragment without an index as the first call', async () => {
        mocks.create.mockReturnValue(newStream([
            newChunk({tool_calls: [{id: 'call_1', function: {name: 'read_file', arguments: '{}'}}]}),
            newChunk({}, 'tool_calls'),
        ]));
        const response = await invoke(newLLM());
        expect(response.delta.tool_calls).toEqual([{
            index: 0, id: 'call_1', type: 'function', function: {name: 'read_file', arguments: '{}'},
        }]);
    });

    test('keeps the usage that arrives with the finishing chunk', async () => {
        const finished = newChunk({content: 'hello'}, 'stop') as {usage?: unknown};
        finished.usage = {prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: {cached_tokens: 40}};
        mocks.create.mockReturnValue(newStream([finished]));
        const response = await invoke(newLLM());
        expect(newLLM().getTokenUsage(response))
            .toEqual({cachedInputTokens: 40, noCachedInputTokens: 60, outputTokens: 20});
    });

    test('keeps the usage of a chunk that arrives before the finishing chunk', async () => {
        const early = newChunk({content: 'he'}) as {usage?: unknown};
        early.usage = {prompt_tokens: 100, completion_tokens: 20};
        mocks.create.mockReturnValue(newStream([early, newChunk({content: 'llo'}, 'stop')]));
        const response = await invoke(newLLM());
        expect(newLLM().getTokenUsage(response))
            .toEqual({cachedInputTokens: 0, noCachedInputTokens: 100, outputTokens: 20});
    });

    test('keeps the usage of the trailing chunk that carries no choice', async () => {
        mocks.create.mockReturnValue(newStream([
            newChunk({content: 'hello'}, 'stop'),
            {choices: [], usage: {prompt_tokens: 100, completion_tokens: 20}},
        ]));
        const response = await invoke(newLLM());
        expect(newLLM().getTokenUsage(response))
            .toEqual({cachedInputTokens: 0, noCachedInputTokens: 100, outputTokens: 20});
    });

    test('ignores a chunk that carries no choice', async () => {
        mocks.create.mockReturnValue(newStream([{choices: []}, newChunk({content: 'hello'}, 'stop')]));
        const response = await invoke(newLLM());
        expect(newLLM().textOf(response)).toBe('hello');
    });

    test('does not finish on the string "null" finish reason', async () => {
        mocks.create.mockReturnValue(newStream([newChunk({content: 'hello'}, 'null')]));
        const response = await invoke(newLLM());
        expect(newLLM().textOf(response)).toBe('Error: No response from LLM.');
    });

    test('reports an empty stream as an error', async () => {
        mocks.create.mockReturnValue(newStream([]));
        const response = await invoke(newLLM());
        expect(newLLM().textOf(response)).toBe('Error: No response from LLM.');
        expect(response.transitionReason).toBe('error');
    });

    test('finishes on a chunk that carries no delta', async () => {
        mocks.create.mockReturnValue(newStream([newChunk(null, 'stop')]));
        const response = await invoke(newLLM());
        expect(newLLM().textOf(response)).toBe('');
        expect(response.transitionReason).toBe('endLoop');
    });

    test('keeps the streamed text of a finishing chunk that carries no delta', async () => {
        mocks.create.mockReturnValue(newStream([newChunk({content: 'hello'}), newChunk(null, 'tool_calls')]));
        const response = await invoke(newLLM());
        expect(newLLM().textOf(response)).toBe('hello');
    });
});

describe('OpenAIChatLLM transition reason', () => {

    test.for([
        ['stop', 'endLoop'],
        ['length', 'maxTokens'],
        ['tool_calls', 'toolUse'],
        ['content_filter', 'refused'],
        ['function_call', 'endLoop'],
    ] as const)('turns the %s finish reason into %s', async ([finishReason, expected]) => {
        mocks.create.mockReturnValue(newStream([newChunk({content: 'hello'}, finishReason)]));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe(expected);
    });
});

describe('OpenAIChatLLM convertResponseToMessages', () => {

    test('turns the response into one assistant message with its tool calls', () => {
        const llm = newLLM();
        const response = llm.build('let me look');
        response.delta.reasoning_content = 'thinking';
        response.delta.tool_calls = [
            {index: 0, id: 'call_1', type: 'function', function: {name: 'read_file', arguments: '{}'}}
        ];
        expect(llm.messagesOf(response)).toEqual([{
            role: 'assistant',
            content: 'let me look',
            reasoning_content: 'thinking',
            tool_calls: [{id: 'call_1', type: 'function', function: {name: 'read_file', arguments: '{}'}}],
        }]);
    });

    test('leaves the reasoning out when the response has none', () => {
        const llm = newLLM();
        expect(llm.messagesOf(llm.build('plain answer'))[0]).toMatchObject({
            role: 'assistant', content: 'plain answer', reasoning_content: undefined,
        });
    });

    test('leaves the tool calls out of a synthetic response', () => {
        const llm = newLLM();
        expect(toolCallsOf(llm.messagesOf(llm.build('plain answer')))).toBeUndefined();
    });

    test('leaves the tool calls out when the vendor sent none', () => {
        const llm = newLLM();
        const response = llm.build('plain answer');
        response.delta.tool_calls = undefined;
        expect(toolCallsOf(llm.messagesOf(response))).toBeUndefined();
    });

    test('replaces a missing tool call id and name with empty strings', () => {
        const llm = newLLM();
        const response = llm.build('');
        response.delta.tool_calls = [{index: 0, type: 'function'}];
        expect(llm.messagesOf(response)[0]).toMatchObject({
            tool_calls: [{id: '', type: 'function', function: {name: '', arguments: ''}}],
        });
    });

    test('appends the assistant message to the history during an invoke', async () => {
        const messages: ThinkingMessage[] = [];
        await invoke(newLLM(), messages);
        expect(messages.at(-1)).toMatchObject({role: 'assistant', content: 'hello'});
    });
});

describe('OpenAIChatLLM getTextFromResponse', () => {

    test('returns the accumulated content', () => {
        expect(newLLM().textOf(newLLM().build('answer'))).toBe('answer');
    });

    test('returns nothing when the response only has tool calls', () => {
        const llm = newLLM();
        const response = llm.build('');
        expect(llm.textOf(response)).toBe('');
    });
});

describe('OpenAIChatLLM getTextFromInputMessage', () => {

    test('returns a plain string content as it is', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: 'plain'})).toBe('plain');
    });

    test('joins the text parts and skips the other parts', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: [
            {type: 'text', text: 'first'},
            {type: 'image_url', image_url: {url: 'https://example.com/a.png'}},
            {type: 'text', text: 'second'},
        ]})).toBe('first\nsecond');
    });

    test('drops empty text parts', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: [
            {type: 'text', text: ''}, {type: 'text', text: 'second'},
        ]})).toBe('second');
    });

    test('returns nothing for a message without content', () => {
        expect(newLLM().getTextFromInputMessage({role: 'assistant', content: null})).toBe('');
    });
});

describe('OpenAIChatLLM getTokenUsage', () => {

    test('splits the prompt tokens into cached and uncached', () => {
        const llm = newLLM();
        const response = llm.build('answer');
        response.usage = {
            prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
            prompt_tokens_details: {cached_tokens: 40},
        };
        expect(llm.getTokenUsage(response))
            .toEqual({cachedInputTokens: 40, noCachedInputTokens: 60, outputTokens: 20});
    });

    test('counts everything as uncached when there are no cache details', () => {
        const llm = newLLM();
        const response = llm.build('answer');
        response.usage = {prompt_tokens: 10, completion_tokens: 2, total_tokens: 12};
        expect(llm.getTokenUsage(response))
            .toEqual({cachedInputTokens: 0, noCachedInputTokens: 10, outputTokens: 2});
    });

    test('reports zeros when the response has no usage', () => {
        const llm = newLLM();
        expect(llm.getTokenUsage(llm.build('answer')))
            .toEqual({cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0});
    });
});
