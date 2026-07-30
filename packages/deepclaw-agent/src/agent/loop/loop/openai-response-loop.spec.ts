import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentHandler} from '@deepclaw/core';
import {type ToolUseResult} from '../../definitions/tool-definitions';
import {type ThinkingResponse} from '../../llm/openai-response-llm';
import {newTestAgentConfig, newTestAgentHandler} from '../../../test-support/one-loop-context';
import {OpenAIResponseLoop} from './openai-response-loop';

const mocks = vi.hoisted(() => ({
    loadAgentConfig: vi.fn<(agentId: string) => unknown>(),
    getSessionDir: vi.fn<(...args: unknown[]) => string>(() => '.agents/a1/session/s1'),
    loadSession: vi.fn<(...args: unknown[]) => unknown>(() => ({history: [], outdated: false})),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

vi.mock('@deepclaw/config', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/config')>()),
    loadAgentConfig: mocks.loadAgentConfig,
}));

vi.mock('../services/prompt-service', () => ({
    PromptService: {provideSystemPrompt: () => ({cacheable: '', dynamic: ''})},
}));

vi.mock('../services/session-service', () => ({
    SessionService: {
        getSessionDir: mocks.getSessionDir,
        loadSession: mocks.loadSession,
        updateSessionRuntime: vi.fn(),
        saveHistory: vi.fn(),
    },
}));

class TestableOpenAIResponseLoop extends OpenAIResponseLoop {
    public protocol() {
        return this.getLLMProtocol();
    }

    public convert(toolResults: ToolUseResult[]) {
        return this.convertToolResultMessages(toolResults);
    }

    public extract(response: ThinkingResponse) {
        return this.extractToolUseFromResponse(response);
    }
}

function newLoop(handler: AgentHandler = newTestAgentHandler() as AgentHandler) {
    mocks.loadAgentConfig.mockReturnValue(newTestAgentConfig({
        llm: {baseURL: 'https://api.openai.com/v1', apiKey: 'key', model: 'gpt'},
    }));
    return new TestableOpenAIResponseLoop('agent', 'a1', '', handler);
}

function newResponse(output: unknown[]): ThinkingResponse {
    return {output} as unknown as ThinkingResponse;
}

describe('OpenAIResponseLoop', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSessionDir.mockReturnValue('.agents/a1/session/s1');
        mocks.loadSession.mockReturnValue({history: [], outdated: false});
    });

    test('speaks the openai response protocol', () => {
        expect(newLoop().protocol()).toBe('OpenAIResponse');
    });

    test('answers every tool result as a completed function call output', () => {
        expect(newLoop().convert([{id: 'tu1', content: 'first'}])).toEqual([{
            role: 'tool',
            call_id: 'tu1',
            output: 'first',
            type: 'function_call_output',
            status: 'completed',
        }]);
    });

    test('reads the function calls out of the output items', () => {
        const response = newResponse([
            {type: 'message', content: 'let me look'},
            {type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"a.md"}'},
        ]);
        expect(newLoop().extract(response)).toEqual([
            {id: 'call_1', name: 'read_file', input: '{"filePath":"a.md"}'},
        ]);
    });

    test('finds no tool call in a plain answer', () => {
        expect(newLoop().extract(newResponse([{type: 'message', content: 'done'}]))).toEqual([]);
    });

    test('gives a sub loop its own session', () => {
        const subLoop = newLoop().createSubLoop();
        expect(subLoop).toBeInstanceOf(OpenAIResponseLoop);
        expect(mocks.getSessionDir.mock.calls.at(-1)![3]).toBeTruthy();
    });
});
