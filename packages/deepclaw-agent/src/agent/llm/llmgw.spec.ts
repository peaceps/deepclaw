import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {LLMGWConfig, LLMTransitionReason, TokenUsage, ImageContent} from '@deepclaw/core';
import type {LLMConfig} from '@deepclaw/config';
import type {SystemPrompt} from '../definitions/definitions';
import type {LLMTool} from '../definitions/tool-definitions';
import {newTestLogger} from '../../test-support/one-loop-context';
import {ToolsManager} from '../loop/services/tools-manager';
import {LLMModel} from './llmgw';

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

    protected override async _invoke(
        system: SystemPrompt,
        messages: FakeMessage[],
        tools: FakeTool[],
        streamer: (text: string) => void
    ): Promise<FakeResponse> {
        this.invokeCalls.push({system, messages: [...messages], tools});
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

function newLLM(isSubLoop: boolean = false, llmConfig: Partial<LLMConfig> = {}): FakeLLM {
    return new FakeLLM(isSubLoop, {
        baseURL: 'https://api.example.com', apiKey: 'key', model: 'sonnet', ...llmConfig
    });
}

function newSystem(): SystemPrompt {
    return {cacheable: 'cacheable prompt', dynamic: 'dynamic prompt'};
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
        expect(newLLM(false, {model: 'opus'}).getGWConfig())
            .toEqual({model: 'opus', timeoutMs: 300000, temperature: 0.1, maxTokens: 8000});
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
            model: 'haiku', timeoutMs: 300000, temperature: 0.1, maxTokens: 8000
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

    test('asks the tools manager for the tools of this loop kind and mode', async () => {
        const llm = newLLM(true);
        await llm.invoke('chat', newSystem(), [], () => undefined, newTestLogger());
        expect(getToolsArray).toHaveBeenCalledExactlyOnceWith(true, 'chat');
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
        });
    });

    test('reports the failure text as the summary when the vendor call keeps failing', async () => {
        const llm = newLLM();
        llm.onInvoke = async () => {
            throw {status: 400, message: 'nope'};
        };
        const {summary} = await llm.compact('agent', newSystem(), 'history', newTestLogger());
        expect(summary).toBe('ERROR: Unrecoverable error: nope.');
    });
});
