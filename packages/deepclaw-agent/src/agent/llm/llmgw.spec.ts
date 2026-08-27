import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {
    FlushAgentRole, LLMGWConfig, LLMTransitionReason, TokenUsage, ImageContent
} from '@deepclaw/core';
import type {LLMConfig} from '@deepclaw/config';
import type {LoopKind, SystemPrompt} from '../definitions/definitions';
import type {LLMTool} from '../definitions/tool-definitions';
import {newTestLogger} from '../../test-support/one-loop-context';
import {ToolsManager} from '../loop/services/tools-manager';
import {isContextOverflowMessage, readOverflowLimit, wordsOfError, LLMModel} from './llmgw';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const getToolsArray = vi.spyOn(ToolsManager, 'getToolsArray');

type FakeMessage = {role: string; content: string};
type FakeResponse = {transitionReason: LLMTransitionReason; text: string; usage: TokenUsage};
type FakeTool = {name: string};
type FakeClient = {baseURL: string; apiKey: string; timeout: number};
type FakeInvokeCall = {system: SystemPrompt; messages: FakeMessage[]; tools: FakeTool[]};

/** Clients are recorded outside the class because createLLMClient runs before field initializers. */
const createdClients: FakeClient[] = [];

class FakeLLM extends LLMModel<FakeMessage, FakeResponse, FakeTool, FakeClient> {

    public readonly invokeCalls: FakeInvokeCall[] = [];
    public readonly streamed: string[] = [];
    public attempts: number = 0;
    public onInvoke: (attempt: number) => Promise<FakeResponse> = async () => this.newResponse('done');

    protected override convertTools(tools: LLMTool[]): FakeTool[] {
        return tools.map(tool => ({name: tool.name}));
    }

    protected override createLLMClient(baseURL: string, apiKey: string, timeout: number): FakeClient {
        const client = {baseURL, apiKey, timeout};
        createdClients.push(client);
        return client;
    }

    public readonly signals: (AbortSignal | undefined)[] = [];

    protected override async _invoke(
        system: SystemPrompt,
        messages: FakeMessage[],
        tools: FakeTool[],
        streamer: (text: string) => void,
        signal?: AbortSignal
    ): Promise<FakeResponse> {
        this.invokeCalls.push({system, messages: [...messages], tools});
        this.signals.push(signal);
        streamer('chunk');
        this.attempts += 1;
        return this.onInvoke(this.attempts);
    }

    protected override isInputExceedLimit(error: unknown): boolean {
        return (error as {tooLong?: boolean} | null)?.tooLong === true;
    }

    protected override newResponse(
        content: string, transitionReason: LLMTransitionReason = 'endLoop'
    ): FakeResponse {
        return {
            transitionReason,
            text: content,
            usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        };
    }

    protected override setTransitionReason(response: FakeResponse): FakeResponse {
        return response;
    }

    protected override convertResponseToMessages(response: FakeResponse): FakeMessage[] {
        return [{role: 'assistant', content: response.text}];
    }

    protected override getTextFromResponse(response: FakeResponse): string {
        return response.text;
    }

    public override getTextFromInputMessage(message: FakeMessage): string {
        return message.content;
    }

    public override getTokenUsage(response: FakeResponse): TokenUsage {
        return response.usage;
    }

    public override newImageInputMessage(content: string, images: ImageContent[]): FakeMessage {
        return {role: 'user', content: `${content} [${images.length} image(s)]`};
    }

    public getClient(): FakeClient {
        return this.client;
    }

    public getGWConfig(): LLMGWConfig {
        return this.gw;
    }
}

function newLLM(
    loopKind: LoopKind = 'main', llmConfig: Partial<LLMConfig> = {}, role: FlushAgentRole = 'agent'
): FakeLLM {
    return new FakeLLM(loopKind, role, {
        baseURL: 'https://api.example.com', apiKey: 'key', model: 'sonnet', ...llmConfig
    });
}

function newSystem(): SystemPrompt {
    return {cacheable: 'cacheable prompt', learned: 'learned prompt', dynamic: 'dynamic prompt'};
}

function newTool(name: string): LLMTool {
    return {name, description: `${name} tool`, schema: {type: 'object'}};
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

beforeEach(() => {
    vi.clearAllMocks();
    createdClients.length = 0;
    getToolsArray.mockReturnValue([]);
});

describe('LLMModel constructor', () => {

    test('derives the gateway config from the llm config and fixed defaults', () => {
        expect(newLLM('main', {model: 'opus'}).getGWConfig())
            .toEqual({model: 'opus', timeoutMs: 300000, maxTokens: 8000});
    });

    test('creates the client with the base url, api key and default timeout', () => {
        const llm = newLLM();
        expect(createdClients).toHaveLength(1);
        expect(llm.getClient()).toEqual({baseURL: 'https://api.example.com', apiKey: 'key', timeout: 300000});
    });
});

describe('LLMModel updateGWConfig', () => {

    test('merges the given values into the gateway config', () => {
        const llm = newLLM();
        llm.updateGWConfig(null, {model: 'haiku'});
        expect(llm.getGWConfig()).toEqual({
            model: 'haiku', timeoutMs: 300000, maxTokens: 8000
        });
    });

    test('keeps the current client when no credentials are given', () => {
        const llm = newLLM();
        const client = llm.getClient();
        llm.updateGWConfig(null, {model: 'haiku'});
        expect(llm.getClient()).toBe(client);
        expect(createdClients).toHaveLength(1);
    });

    test('rebuilds the client when new credentials are given', () => {
        const llm = newLLM();
        llm.updateGWConfig({baseURL: 'https://other.example.com', apiKey: 'key2'}, {model: 'haiku'});
        expect(createdClients).toHaveLength(2);
        expect(llm.getClient())
            .toEqual({baseURL: 'https://other.example.com', apiKey: 'key2', timeout: 300000});
    });
});

describe('LLMModel invoke tools', () => {

    test('asks the tools manager for the tools of this run', async () => {
        const llm = newLLM('task', {}, 'cron');
        await llm.invoke('chat', newSystem(), [], () => undefined, newTestLogger());
        expect(getToolsArray).toHaveBeenCalledExactlyOnceWith(
            {loopKind: 'task', role: 'cron', mode: 'chat'}
        );
    });

    test('converts the tools once and hands them to the vendor call', async () => {
        getToolsArray.mockReturnValue([newTool('read_file'), newTool('write_file')]);
        const llm = newLLM();
        await llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger());
        expect(llm.invokeCalls[0]!.tools).toEqual([{name: 'read_file'}, {name: 'write_file'}]);
    });
});

describe('LLMModel invoke success', () => {

    test('returns the response of the vendor call', async () => {
        const llm = newLLM();
        const response = await llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger());
        expect(response).toEqual({
            transitionReason: 'endLoop',
            text: 'done',
            usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        });
        expect(llm.attempts).toBe(1);
    });

    test('appends the converted response to the message history', async () => {
        const llm = newLLM();
        const messages: FakeMessage[] = [{role: 'user', content: 'hi'}];
        await llm.invoke('agent', newSystem(), messages, () => undefined, newTestLogger());
        expect(messages).toEqual([{role: 'user', content: 'hi'}, {role: 'assistant', content: 'done'}]);
    });

    test('forwards the system prompt and the current history to the vendor call', async () => {
        const llm = newLLM();
        await llm.invoke('agent', newSystem(), [{role: 'user', content: 'hi'}], () => undefined, newTestLogger());
        expect(llm.invokeCalls[0]!.system).toEqual(newSystem());
        expect(llm.invokeCalls[0]!.messages).toEqual([{role: 'user', content: 'hi'}]);
    });

    test('passes the streamer through to the vendor call', async () => {
        const streamer = vi.fn<(text: string) => void>(() => undefined);
        await newLLM().invoke('agent', newSystem(), [], streamer, newTestLogger());
        expect(streamer).toHaveBeenCalledExactlyOnceWith('chunk');
    });
});

describe('LLMModel invoke retries', () => {

    test('retries after a failure and returns the later success', async () => {
        const llm = newLLM();
        llm.onInvoke = async attempt => {
            if (attempt === 1) {
                throw {status: 500, message: 'boom'};
            }
            return {
                transitionReason: 'toolUse',
                text: 'recovered',
                usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
            };
        };
        const response = await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger())
        );
        expect(response.text).toBe('recovered');
        expect(llm.attempts).toBe(2);
    });

    test('gives up after three failures with an error response', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status: 500, message: 'boom'};
        };
        const response = await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger())
        );
        expect(response).toMatchObject({
            transitionReason: 'error', text: 'ERROR: LLM invoke failed after 3 retries.'
        });
        expect(llm.attempts).toBe(3);
    });

    test('records the give-up message in the message history', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status: 500, message: 'boom'};
        };
        const messages: FakeMessage[] = [];
        await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), messages, () => undefined, newTestLogger())
        );
        expect(messages).toEqual([{role: 'assistant', content: 'ERROR: LLM invoke failed after 3 retries.'}]);
    });

    test('logs every failed attempt', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status: 500, message: 'boom'};
        };
        const logger = newTestLogger();
        await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, logger)
        );
        expect(logger.error).toHaveBeenCalledTimes(3);
        expect(logger.error).toHaveBeenCalledWith({status: 500, message: 'boom'}, 'LLM invoke failed');
    });
});

describe('LLMModel invoke unrecoverable errors', () => {

    test.for([400, 401, 403, 404, 429])('stops right away on status %i', async status => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status, message: 'nope'};
        };
        const response = await llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger());
        expect(response).toMatchObject({
            transitionReason: 'error', text: 'ERROR: Unrecoverable error: nope.'
        });
        expect(llm.attempts).toBe(1);
    });

    test('falls back to the status code when the error carries no message', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status: 429};
        };
        const response = await llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger());
        expect(response.text).toBe('ERROR: Unrecoverable error: 429.');
    });

    test('treats a server error as recoverable and keeps retrying', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status: 503, message: 'unavailable'};
        };
        await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger())
        );
        expect(llm.attempts).toBe(3);
    });
});

describe('LLMModel invoke input too long', () => {

    test('answers with an inputMaxTokens response', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {tooLong: true};
        };
        const response = await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger())
        );
        expect(response).toMatchObject({
            transitionReason: 'inputMaxTokens', text: 'Input token exceeds the limit.'
        });
    });

    test('keeps the limit the refusal named for whoever records it', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {tooLong: true, message: 'Range of input length should be [1, 983616]'};
        };
        await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger())
        );
        expect(llm.takeObservedLimit()).toEqual({tokens: 983616});
        // Taken once. The turn that reads it is the turn it happened in, and a later turn asking
        // again would be told of a refusal that is not its own.
        expect(llm.takeObservedLimit()).toBeUndefined();
    });

    test('has nothing to hand over when the call went through', async () => {
        const llm = newLLM();
        await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger())
        );
        expect(llm.takeObservedLimit()).toBeUndefined();
    });

    test('leaves the message history untouched so the caller can compact it', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {tooLong: true};
        };
        const messages: FakeMessage[] = [{role: 'user', content: 'a very long history'}];
        await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), messages, () => undefined, newTestLogger())
        );
        expect(messages).toEqual([{role: 'user', content: 'a very long history'}]);
    });

    test('asks the vendor only once and leaves the retries to the caller', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {tooLong: true};
        };
        await runWithoutWaiting(
            () => llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger())
        );
        expect(llm.attempts).toBe(1);
    });
});

describe('LLMModel under a stop', () => {

    test('hands the signal to the vendor call', async () => {
        const llm = newLLM();
        const signal = new AbortController().signal;
        await llm.invoke('agent', newSystem(), [], () => undefined, newTestLogger(), signal);
        expect(llm.signals).toEqual([signal]);
    });

    /**
     * An aborted call carries no status, so the check for what cannot be recovered from lets it
     * through and it reads as an ordinary failure. Retried, it fails the same way twice more, and
     * a second passes between the user pressing stop and anything happening.
     */
    test('gives up at once instead of retrying a call the stop cut short', async () => {
        const llm = newLLM();
        const controller = new AbortController();
        llm.onInvoke = async () => {
            controller.abort();
            throw Object.assign(new Error('Request was aborted.'), {status: undefined});
        };
        // Awaited without driving any timer on purpose: the retry path sleeps between attempts,
        // so a call that comes back at all is a call that never went down it.
        await expect(llm.invoke(
            'agent', newSystem(), [], () => undefined, newTestLogger(), controller.signal
        )).rejects.toThrow('Request was aborted.');
        expect(llm.attempts).toBe(1);
    });

    /**
     * It leaves as it came rather than as a response. A response would be an answer of the model
     * as far as the loop can tell, and a turn ending on one has ended by itself: the stop would be
     * dropped as the crossing-in-flight case it looks exactly like.
     */
    test('throws rather than answering, so that the loop can tell a stop from an answer', async () => {
        const llm = newLLM();
        const controller = new AbortController();
        const messages: FakeMessage[] = [];
        llm.onInvoke = async () => {
            controller.abort();
            throw new Error('Request was aborted.');
        };
        await expect(llm.invoke(
            'agent', newSystem(), messages, () => undefined, newTestLogger(), controller.signal
        )).rejects.toThrow();
        expect(messages).toEqual([]);
    });

    /** Compaction is a call like any other, and the one most worth being able to stop. */
    test('compacts under the signal it was given', async () => {
        const llm = newLLM();
        const signal = new AbortController().signal;
        await llm.compact('agent', newSystem(), 'the history', newTestLogger(), signal);
        expect(llm.signals).toEqual([signal]);
    });
});

describe('LLMModel newInputMessage', () => {

    test('builds a user message by default', () => {
        expect(newLLM().newInputMessage('hello')).toEqual({role: 'user', content: 'hello'});
    });

    test('builds an assistant message when asked for one', () => {
        expect(newLLM().newInputMessage('hello', false)).toEqual({role: 'assistant', content: 'hello'});
    });
});

describe('LLMModel compact', () => {

    test('sends the history as one user message wrapped in a summarize prompt', async () => {
        const llm = newLLM();
        await llm.compact('agent', newSystem(), '{"role":"user"}', newTestLogger());
        const sent = llm.invokeCalls[0]!.messages;
        expect(sent).toHaveLength(1);
        expect(sent[0]!.role).toBe('user');
        expect(sent[0]!.content).toContain('Summarize this agent conversation so work can continue.');
        expect(sent[0]!.content).toContain('The step to take next, which is the most important thing');
        expect(sent[0]!.content).toContain('{"role":"user"}');
    });

    test('returns the response text as the summary together with its token usage', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => ({
            transitionReason: 'endLoop',
            text: 'the summary',
            usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
        });
        expect(await llm.compact('agent', newSystem(), 'history', newTestLogger())).toEqual({
            summary: 'the summary',
            tokenUsage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
            usable: true,
        });
    });

    test('reports the failure text as the summary when the vendor call keeps failing', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status: 400, message: 'nope'};
        };
        const {summary, usable} = await llm.compact('agent', newSystem(), 'history', newTestLogger());
        expect(summary).toBe('ERROR: Unrecoverable error: nope.');
        expect(usable).toBe(false);
    });

    test('marks a refused summary unusable rather than passing the notice off as one', async () => {
        // The summarizer is handed the same history in one message, so a history too long for the
        // model is too long for the call meant to shorten it, and this is the likely failure of
        // the two. Taken for a summary it would stand in place of the whole conversation.
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {tooLong: true, message: 'prompt is too long: 300000 tokens > 200000 maximum'};
        };
        const {summary, usable} = await runWithoutWaiting(
            () => llm.compact('agent', newSystem(), 'history', newTestLogger())
        );
        expect(summary).toBe('Input token exceeds the limit.');
        expect(usable).toBe(false);
    });

    test('refuses an empty summary from a call that reported no trouble at all', async () => {
        // The tools are bound to this call as to any other, and a conversation made largely of
        // tool traces invites a tool call in reply. That is `toolUse`, which nothing reads as a
        // failure, with no text beside it -- and an empty summary shipped as a good one is the
        // whole conversation replaced by a heading.
        const llm = newLLM();
        llm.onInvoke = async () => ({
            transitionReason: 'toolUse',
            text: '',
            usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
        });
        const {usable} = await llm.compact('agent', newSystem(), 'history', newTestLogger());
        expect(usable).toBe(false);
    });

    test('refuses a summary of nothing but whitespace', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => ({
            transitionReason: 'endLoop',
            text: ' \n\t ',
            usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
        });
        const {usable} = await llm.compact('agent', newSystem(), 'history', newTestLogger());
        expect(usable).toBe(false);
    });

    test('keeps a summary that was merely cut short by the output limit', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => ({
            transitionReason: 'maxTokens',
            text: 'half a summary',
            usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
        });
        const {usable} = await llm.compact('agent', newSystem(), 'history', newTestLogger());
        expect(usable).toBe(true);
    });

    test('keeps the refusal of a summary out of what the main loop collects', async () => {
        // Both calls go through the same invoke and leave the observation in the same place, but
        // only the main loop ever collects it. Left sitting here it would be picked up by the next
        // main call that succeeded, and a call that went through would be recorded as refused.
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {tooLong: true, message: 'prompt is too long: 300000 tokens > 200000 maximum'};
        };
        await runWithoutWaiting(
            () => llm.compact('agent', newSystem(), 'history', newTestLogger())
        );
        expect(llm.takeObservedLimit()).toBeUndefined();
    });
});

describe('isContextOverflowMessage', () => {

    test.for([
        'prompt is too long: 200000 tokens > 199999 maximum',
        'Your MESSAGES are TOO LARGE',
        "This model's maximum context length is 128000 tokens",
        'exceed context limit',
        'context_length_exceeded',
        // Measured against DashScope: the window as a range, and the body as bytes.
        '<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 983616]',
        'Exceeded limit on max bytes to request body : 6291456',
    ])('reads %s as an overflow', (message) => {
        expect(isContextOverflowMessage(message)).toBe(true);
    });

    test.for([
        'bad tool schema',
        'invalid api key',
        'rate limit exceeded',
        '',
        // Oversized, but not the conversation. Summarizing would not shorten a name or an image,
        // and the run would go on from a summary it never needed.
        'the file you uploaded is too large',
        'tool name too long',
        // The trap in reading the whole message: a 400 body says `request` however it failed, and
        // here it sits four words from the complaint while meaning nothing of the sort.
        'Invalid request: image too large',
        'invalid_request_error: the input parameter is malformed and the name is too long',
    ])('leaves %s alone', (message) => {
        expect(isContextOverflowMessage(message)).toBe(false);
    });

    test('takes a bare complaint of size only once it names the conversation', () => {
        expect(isContextOverflowMessage('it is too long')).toBe(false);
        expect(isContextOverflowMessage('the prompt is too long')).toBe(true);
    });

    test('wants the subject beside the complaint, not merely somewhere in the message', () => {
        expect(isContextOverflowMessage('the prompt was fine. the uploaded image is too large'))
            .toBe(false);
        expect(isContextOverflowMessage('conversation is too long')).toBe(true);
    });

    test('treats a missing message as no complaint at all', () => {
        expect(isContextOverflowMessage(undefined)).toBe(false);
        expect(isContextOverflowMessage(null)).toBe(false);
    });
});

describe('readOverflowLimit', () => {

    test.for([
        // Measured against DashScope. The window is the far end of the range, not the near one.
        ['<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 983616]',
            983616],
        // Anthropic. The window is the second number, what was sent being the first.
        ['prompt is too long: 215432 tokens > 200000 maximum', 200000],
        // OpenAI, where the window comes first instead.
        ["This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens",
            128000],
    ])('reads the window out of %s', ([message, expected]) => {
        expect(readOverflowLimit(message)).toEqual({tokens: expected});
    });

    test('reads the byte wall of a gateway as bytes and not as a window', () => {
        // Six million taken for a window would be a window nothing could ever fill, and a history
        // that never compacted again.
        expect(readOverflowLimit('Exceeded limit on max bytes to request body : 6291456'))
            .toEqual({bytes: 6291456});
    });

    test('comes back empty from an overflow that named no number', () => {
        expect(readOverflowLimit('input is too long')).toEqual({});
        expect(readOverflowLimit(undefined)).toEqual({});
    });

    test('ignores a limit of zero, which is no limit anyone could work under', () => {
        expect(readOverflowLimit('Range of input length should be [1, 0]')).toEqual({});
    });
});

describe('wordsOfError', () => {

    test('reads both places a refusal keeps its words', () => {
        // Not the first of the two that happens to be there: a top-level message that says
        // nothing about size would otherwise hide a nested one that names the limit exactly.
        const error = {
            message: 'Error code: 400',
            error: {message: 'Range of input length should be [1, 983616]'},
        };
        expect(readOverflowLimit(wordsOfError(error))).toEqual({tokens: 983616});
        expect(isContextOverflowMessage(wordsOfError(error))).toBe(true);
    });

    test('keeps the two apart so no phrase is made out of the seam', () => {
        expect(wordsOfError({message: 'context', error: {message: 'length'}}))
            .toBe('context\nlength');
    });

    test('comes back empty from an error that said nothing', () => {
        expect(wordsOfError({})).toBe('');
        expect(wordsOfError(undefined)).toBe('');
    });
});
