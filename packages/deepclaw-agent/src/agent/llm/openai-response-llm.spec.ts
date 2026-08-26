import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {Tool} from 'openai/resources/responses/responses.js';
import type {LLMTransitionReason} from '@deepclaw/core';
import type {LLMTool} from '../definitions/tool-definitions';
import {newTestLogger} from '../../test-support/one-loop-context';
import {ToolsManager} from '../loop/services/tools-manager';
import {OpenAIResponseLLM, type ThinkingMessage, type ThinkingResponse} from './openai-response-llm';

const mocks = vi.hoisted(() => ({
    newClient: vi.fn<(options: unknown) => void>(() => undefined),
    create: vi.fn(),
    readImage: vi.fn<(key: string) => Buffer | null>(),
}));

vi.mock('openai', () => {
    class FakeOpenAI {
        public responses = {create: mocks.create};
        constructor(options: unknown) {
            mocks.newClient(options);
        }
    }
    return {default: FakeOpenAI, OpenAI: FakeOpenAI};
});

vi.mock('@deepclaw/i18n', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/i18n')>()),
    i18nInstance: {t: (key: string) => key},
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    ImageStore: {read: mocks.readImage},
}));

const getToolsArray = vi.spyOn(ToolsManager, 'getToolsArray');

class TestableOpenAIResponseLLM extends OpenAIResponseLLM {

    public tools(tools: LLMTool[]): Tool[] {
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

    public transitionOf(response: ThinkingResponse): ThinkingResponse {
        return this.setTransitionReason(response);
    }
}

function newLLM(): TestableOpenAIResponseLLM {
    return new TestableOpenAIResponseLLM('main', 'agent', {
        baseURL: 'https://api.openai.example.com', apiKey: 'key', model: 'gpt-test'
    });
}

function newTool(name: string): LLMTool {
    return {name, description: `${name} tool`, schema: {type: 'object', properties: {a: {type: 'string'}}}};
}

function newTextOutput(text: string): unknown {
    return {
        id: 'msg_1', status: 'completed', type: 'message', role: 'assistant',
        content: [{type: 'output_text', text, annotations: []}],
    };
}

function newFunctionCall(name: string, callId: string): unknown {
    return {id: 'fc_1', type: 'function_call', status: 'completed', name, call_id: callId, arguments: '{}'};
}

function newVendorResponse(overrides: Record<string, unknown> = {}): ThinkingResponse {
    return {
        id: 'resp_1',
        object: 'response',
        created_at: 0,
        status: 'completed',
        output: [newTextOutput('hello')],
        output_text: '',
        error: null,
        incomplete_details: null,
        instructions: '',
        metadata: null,
        model: 'gpt-test',
        tools: [],
        temperature: 0.1,
        parallel_tool_calls: false,
        tool_choice: 'none',
        top_p: 1,
        ...overrides,
    } as unknown as ThinkingResponse;
}

function newStream(events: unknown[]): AsyncIterable<unknown> {
    return {
        async* [Symbol.asyncIterator]() {
            for (const event of events) {
                yield event;
            }
        },
    };
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

function invoke(
    llm: OpenAIResponseLLM,
    messages: ThinkingMessage[] = [],
    streamer: (text: string) => void = () => undefined,
    signal?: AbortSignal
): Promise<ThinkingResponse> {
    return llm.invoke(
        'agent', {cacheable: 'cacheable prompt', learned: 'learned prompt', dynamic: 'dynamic prompt'},
        messages, streamer, newTestLogger(), signal
    );
}

function aborted(): AbortSignal {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
}

beforeEach(() => {
    vi.clearAllMocks();
    getToolsArray.mockReturnValue([]);
    mocks.create.mockReturnValue(newStream([{type: 'response.completed', response: newVendorResponse()}]));
});

describe('OpenAIResponseLLM convertTools', () => {

    test('declares every tool as a strict function tool', () => {
        expect(newLLM().tools([newTool('read_file')])).toEqual([{
            type: 'function',
            name: 'read_file',
            strict: true,
            description: 'read_file tool',
            parameters: {type: 'object', properties: {a: {type: 'string'}}},
        }]);
    });

    test('returns nothing when there is no tool at all', () => {
        expect(newLLM().tools([])).toEqual([]);
    });
});

describe('OpenAIResponseLLM createLLMClient', () => {

    test('builds the sdk client with the base url, api key and timeout', () => {
        newLLM();
        expect(mocks.newClient).toHaveBeenCalledExactlyOnceWith({
            baseURL: 'https://api.openai.example.com', apiKey: 'key', timeout: 300000
        });
    });
});

describe('OpenAIResponseLLM request', () => {

    test('keeps only the cached prompts in the instructions', async () => {
        await invoke(newLLM());
        expect(mocks.create.mock.calls[0]![0])
            .toMatchObject({instructions: 'cacheable prompt\nlearned prompt'});
    });

    test('sends the model, the tools and the gateway limits as a stream', async () => {
        getToolsArray.mockReturnValue([newTool('read_file')]);
        await invoke(newLLM());
        expect(mocks.create.mock.calls[0]![0]).toMatchObject({
            model: 'gpt-test',
            stream: true,
            max_output_tokens: 8000,
            temperature: 0.1,
            tools: [{type: 'function', name: 'read_file', strict: true}],
        });
    });

    test('sends the history followed by the state of the moment', async () => {
        await invoke(newLLM(), [{role: 'user', content: 'hi'}]);
        expect((mocks.create.mock.calls[0]![0] as {input: unknown}).input).toEqual([
            {role: 'user', content: 'hi'},
            {role: 'developer', content: 'dynamic prompt'},
        ]);
    });

    test('leaves the state out when there is none to send', async () => {
        await newLLM().invoke(
            'agent', {cacheable: 'cacheable prompt', learned: 'learned prompt', dynamic: '  '},
            [{role: 'user', content: 'hi'}], () => undefined, newTestLogger()
        );
        expect((mocks.create.mock.calls[0]![0] as {input: unknown}).input)
            .toEqual([{role: 'user', content: 'hi'}]);
    });

    test('keeps the state out of the history, so the next call carries one only', async () => {
        const messages: ThinkingMessage[] = [{role: 'user', content: 'hi'}];
        await invoke(newLLM(), messages);
        expect(messages).toEqual([{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}]);
    });

    test('sends the bytes the reference points at as a data url', async () => {
        mocks.readImage.mockReturnValue(Buffer.from('ABC'));
        const messages = [newLLM().newImageInputMessage('look', [{url: 'dcimg://abc123.png'}])];
        await invoke(newLLM(), messages);
        const sent = (mocks.create.mock.calls[0]![0] as {input: {content: unknown[]}[]}).input[0]!.content;
        expect(sent[1]).toEqual({
            type: 'input_image', detail: 'auto',
            image_url: `data:image/png;base64,${Buffer.from('ABC').toString('base64')}`,
        });
        expect((messages[0] as {content: unknown[]}).content[1]).toEqual({
            type: 'input_image', detail: 'auto', image_url: 'dcimg://abc123.png'
        });
    });

    test('tells the model about an image whose bytes are gone', async () => {
        mocks.readImage.mockReturnValue(null);
        await invoke(newLLM(), [newLLM().newImageInputMessage('look', [{url: 'dcimg://abc123.png'}])]);
        const sent = (mocks.create.mock.calls[0]![0] as {input: {content: unknown[]}[]}).input[0]!.content;
        expect(sent[1]).toEqual({type: 'input_text', text: '[image unavailable, its bytes are gone]'});
    });

    test('adds no system message to the history, unlike the chat protocol', async () => {
        const messages: ThinkingMessage[] = [{role: 'user', content: 'hi'}];
        await invoke(newLLM(), messages);
        expect(messages[0]).toEqual({role: 'user', content: 'hi'});
        expect(messages.some(message => 'role' in message && message.role === 'system')).toBe(false);
    });
});

describe('OpenAIResponseLLM streaming', () => {

    test('streams every output text delta', async () => {
        mocks.create.mockReturnValue(newStream([
            {type: 'response.output_text.delta', delta: 'he'},
            {type: 'response.output_text.delta', delta: 'llo'},
            {type: 'response.completed', response: newVendorResponse()},
        ]));
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        await invoke(newLLM(), [], streamer);
        expect(streamer.mock.calls).toEqual([['he'], ['llo']]);
    });

    test('returns the completed response and stops reading the stream', async () => {
        mocks.create.mockReturnValue(newStream([
            {type: 'response.completed', response: newVendorResponse()},
            {type: 'response.output_text.delta', delta: 'never read'},
        ]));
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        const response = await invoke(newLLM(), [], streamer);
        expect(newLLM().textOf(response)).toBe('hello');
        expect(streamer).not.toHaveBeenCalled();
    });

    test('ignores the events it does not care about', async () => {
        mocks.create.mockReturnValue(newStream([
            {type: 'response.created', response: newVendorResponse()},
            {type: 'response.output_item.added', item: newTextOutput('hello')},
            {type: 'response.completed', response: newVendorResponse()},
        ]));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('endLoop');
    });

    test('turns a failed response into a streamed error message', async () => {
        mocks.create.mockReturnValue(newStream([
            {type: 'response.failed', response: {error: {message: 'upstream died'}}},
        ]));
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        const response = await invoke(newLLM(), [], streamer);
        expect(response.transitionReason).toBe('error');
        expect(newLLM().textOf(response)).toBe('agent.llm.openai.response.output.failed');
        expect(streamer).toHaveBeenCalledExactlyOnceWith('agent.llm.openai.response.output.failed');
    });

    test('turns a stream error event into a streamed error message', async () => {
        mocks.create.mockReturnValue(newStream([
            {type: 'error', code: 'rate_limit', param: 'input', message: 'slow down'},
        ]));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('error');
        expect(newLLM().textOf(response)).toBe('agent.llm.openai.response.output.error');
    });

    test('reports an empty stream as an error', async () => {
        mocks.create.mockReturnValue(newStream([]));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('error');
        expect(newLLM().textOf(response)).toBe('agent.llm.openai.response.output.empty');
    });
});

describe('OpenAIResponseLLM under a stop', () => {

    test('hands the signal to the sdk, which is what ends the stream', async () => {
        const signal = new AbortController().signal;
        await invoke(newLLM(), [], () => undefined, signal);
        expect(mocks.create.mock.calls[0]![1]).toEqual({signal});
    });

    test('throws over a stream that never completed, rather than answering an error', async () => {
        mocks.create.mockReturnValue(newStream([{type: 'response.output_text.delta', delta: 'half'}]));
        await expect(invoke(newLLM(), [], () => undefined, aborted())).rejects.toThrow();
    });

    test('streams no error under the words the user stopped', async () => {
        mocks.create.mockReturnValue(newStream([{type: 'response.output_text.delta', delta: 'half'}]));
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        await expect(invoke(newLLM(), [], streamer, aborted())).rejects.toThrow();
        expect(streamer.mock.calls).toEqual([['half']]);
    });

    test('answers the model that finished, the stop and the last event having crossed', async () => {
        const response = await invoke(newLLM(), [], () => undefined, aborted());
        expect(newLLM().textOf(response)).toBe('hello');
    });

    test('still reports an empty stream as an error while no stop is on', async () => {
        mocks.create.mockReturnValue(newStream([]));
        const response = await invoke(newLLM(), [], () => undefined, new AbortController().signal);
        expect(newLLM().textOf(response)).toBe('agent.llm.openai.response.output.empty');
    });
});

describe('OpenAIResponseLLM transition reason', () => {

    test('ends the loop when a completed response only has text', async () => {
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('endLoop');
    });

    test('asks for tools when a completed response contains a function call', async () => {
        mocks.create.mockReturnValue(newStream([{type: 'response.completed', response: newVendorResponse({
            output: [newTextOutput('let me look'), newFunctionCall('read_file', 'call_1')],
        })}]));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('toolUse');
    });

    test('reports the max output tokens of an incomplete response', async () => {
        mocks.create.mockReturnValue(newStream([{type: 'response.completed', response: newVendorResponse({
            status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'},
        })}]));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('maxTokens');
    });

    test('reports a content filter of an incomplete response as a refusal', async () => {
        mocks.create.mockReturnValue(newStream([{type: 'response.completed', response: newVendorResponse({
            status: 'incomplete', incomplete_details: {reason: 'content_filter'},
        })}]));
        const response = await invoke(newLLM());
        expect(response.transitionReason).toBe('refused');
    });

    test('rejects a status it cannot map without marking the response', () => {
        const response = newVendorResponse({status: 'in_progress'});
        expect(() => newLLM().transitionOf(response)).toThrow('Invalid response status: in_progress');
        expect(response.transitionReason).toBeUndefined();
    });

    test('retries and gives up when the status cannot be mapped', async () => {
        mocks.create.mockImplementation(() => newStream([
            {type: 'response.completed', response: newVendorResponse({status: 'in_progress'})},
        ]));
        const response = await runWithoutWaiting(() => invoke(newLLM()));
        expect(response.transitionReason).toBe('error');
        expect(newLLM().textOf(response)).toBe('ERROR: LLM invoke failed after 3 retries.');
        expect(mocks.create).toHaveBeenCalledTimes(3);
    });

    test('leaves the vendor response untouched while it retries', async () => {
        const shared = newVendorResponse({status: 'in_progress'});
        mocks.create.mockReturnValue(newStream([{type: 'response.completed', response: shared}]));
        await runWithoutWaiting(() => invoke(newLLM()));
        expect(shared.transitionReason).toBeUndefined();
        expect(mocks.create).toHaveBeenCalledTimes(3);
    });
});

describe('OpenAIResponseLLM convertResponseToMessages', () => {

    test('keeps only the function calls when the response asks for tools', () => {
        const llm = newLLM();
        const response = newVendorResponse({
            output: [newTextOutput('let me look'), newFunctionCall('read_file', 'call_1')],
        });
        expect(llm.messagesOf(response)).toEqual([{
            type: 'function_call', call_id: 'call_1', arguments: '{}', name: 'read_file', id: 'fc_1',
        }]);
    });

    test('joins the text of the message outputs into one assistant message', () => {
        const llm = newLLM();
        const response = newVendorResponse({output: [newTextOutput('first'), newTextOutput('second')]});
        expect(llm.messagesOf(response)).toEqual([{role: 'assistant', content: 'first\nsecond'}]);
    });

    test('falls back to the flattened output text when the outputs carry no text', () => {
        const llm = newLLM();
        const response = newVendorResponse({output: [], output_text: 'flattened'});
        expect(llm.messagesOf(response)).toEqual([{role: 'assistant', content: 'flattened'}]);
    });

    test('produces an empty assistant message when there is nothing at all', () => {
        const llm = newLLM();
        expect(llm.messagesOf(newVendorResponse({output: [], output_text: null})))
            .toEqual([{role: 'assistant', content: ''}]);
    });

    test('appends the assistant message to the history during an invoke', async () => {
        const messages: ThinkingMessage[] = [];
        await invoke(newLLM(), messages);
        expect(messages).toEqual([{role: 'assistant', content: 'hello'}]);
    });
});

describe('OpenAIResponseLLM newResponse', () => {

    test('wraps the text in a completed assistant message output', () => {
        const response = newLLM().build('something went wrong');
        expect(response.output).toEqual([{
            id: expect.any(String),
            status: 'completed',
            type: 'message',
            role: 'assistant',
            content: [{type: 'output_text', text: 'something went wrong', annotations: []}],
        }]);
        expect(response.model).toBe('gpt-test');
    });

    test('ends the loop unless another reason is given', () => {
        expect(newLLM().build('bye').transitionReason).toBe('endLoop');
        expect(newLLM().build('bye', 'error').transitionReason).toBe('error');
    });

    test('gives every synthetic response its own id', () => {
        const llm = newLLM();
        expect(llm.build('a').id).not.toBe(llm.build('b').id);
    });
});

describe('OpenAIResponseLLM getTextFromResponse', () => {

    test('joins the text of every message output', () => {
        expect(newLLM().textOf(newVendorResponse({
            output: [newTextOutput('first'), newTextOutput('second')]
        }))).toBe('first\nsecond');
    });

    test('skips the function call outputs', () => {
        expect(newLLM().textOf(newVendorResponse({
            output: [newFunctionCall('read_file', 'call_1'), newTextOutput('text')]
        }))).toBe('text');
    });

    test('skips a refusal block inside a message output', () => {
        expect(newLLM().textOf(newVendorResponse({output: [{
            id: 'msg_1', status: 'completed', type: 'message', role: 'assistant',
            content: [{type: 'refusal', refusal: 'no'}, {type: 'output_text', text: 'yes', annotations: []}],
        }]}))).toBe('yes');
    });

    test('returns nothing when the response only calls tools', () => {
        expect(newLLM().textOf(newVendorResponse({output: [newFunctionCall('read_file', 'call_1')]}))).toBe('');
    });
});

describe('OpenAIResponseLLM getTextFromInputMessage', () => {

    test('returns nothing for a function call', () => {
        expect(newLLM().getTextFromInputMessage({
            type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{}'
        })).toBe('');
    });

    test('returns nothing for a function call output', () => {
        expect(newLLM().getTextFromInputMessage({
            type: 'function_call_output', call_id: 'call_1', output: 'the result'
        })).toBe('');
    });

    test('returns a plain string content as it is', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: 'plain'})).toBe('plain');
    });

    test('joins the input text blocks and skips the other blocks', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: [
            {type: 'input_text', text: 'first'},
            {type: 'input_image', detail: 'auto', image_url: 'https://example.com/a.png'},
            {type: 'input_text', text: 'second'},
        ]})).toBe('first\nsecond');
    });

    test('drops empty input text blocks', () => {
        expect(newLLM().getTextFromInputMessage({role: 'user', content: [
            {type: 'input_text', text: ''}, {type: 'input_text', text: 'second'},
        ]})).toBe('second');
    });
});

describe('OpenAIResponseLLM getTokenUsage', () => {

    test('splits the input tokens into cached and uncached', () => {
        expect(newLLM().getTokenUsage(newVendorResponse({usage: {
            input_tokens: 100, output_tokens: 20, total_tokens: 120,
            input_tokens_details: {cached_tokens: 40},
            output_tokens_details: {reasoning_tokens: 5},
        }}))).toEqual({cachedInputTokens: 40, noCachedInputTokens: 60, outputTokens: 20});
    });

    test('counts everything as uncached when there are no cache details', () => {
        expect(newLLM().getTokenUsage(newVendorResponse({usage: {
            input_tokens: 10, output_tokens: 2, total_tokens: 12,
        }}))).toEqual({cachedInputTokens: 0, noCachedInputTokens: 10, outputTokens: 2});
    });

    test('reports zeros when the response has no usage', () => {
        expect(newLLM().getTokenUsage(newVendorResponse()))
            .toEqual({cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0});
    });
});
