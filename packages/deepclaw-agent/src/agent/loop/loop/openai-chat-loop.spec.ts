import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentHandler} from '@deepclaw/core';
import {type ToolUseResult} from '../../definitions/tool-definitions';
import {type ThinkingResponse} from '../../llm/openai-chat-llm';
import {newTestAgentConfig, newTestAgentHandler} from '../../../test-support/one-loop-context';
import {OpenAIChatLoop} from './openai-chat-loop';

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
    PromptService: {
        provideSystemPrompt: () => ({cacheable: '', dynamic: ''}),
        taskAssignee: () => undefined,
    },
}));

vi.mock('../services/session-service', () => ({
    SessionService: {
        getSessionDir: mocks.getSessionDir,
        loadSession: mocks.loadSession,
        updateSessionRuntime: vi.fn(),
        saveHistory: vi.fn(),
    },
}));

class TestableOpenAIChatLoop extends OpenAIChatLoop {
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
    return new TestableOpenAIChatLoop('agent', 'a1', '', handler);
}

function newResponse(toolCalls: unknown[] | undefined): ThinkingResponse {
    return {delta: {tool_calls: toolCalls}} as unknown as ThinkingResponse;
}

describe('OpenAIChatLoop', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSessionDir.mockReturnValue('.agents/a1/session/s1');
        mocks.loadSession.mockReturnValue({history: [], outdated: false});
    });

    test('speaks the openai chat protocol', () => {
        expect(newLoop().protocol()).toBe('OpenAIChat');
    });

    test('answers every tool result with its own tool message', () => {
        expect(newLoop().convert([{id: 'tu1', content: 'first'}, {id: 'tu2', content: 'second'}])).toEqual([
            {role: 'tool', tool_call_id: 'tu1', content: 'first'},
            {role: 'tool', tool_call_id: 'tu2', content: 'second'},
        ]);
    });

    test('reads the tool calls out of the streamed delta', () => {
        const response = newResponse([
            {id: 'call_1', function: {name: 'read_file', arguments: '{"filePath":"a.md"}'}},
        ]);
        expect(newLoop().extract(response)).toEqual([
            {id: 'call_1', name: 'read_file', input: '{"filePath":"a.md"}'},
        ]);
    });

    test('finds no tool call in a plain answer', () => {
        expect(newLoop().extract(newResponse(undefined))).toEqual([]);
    });

    test('survives a tool call the model left half empty', () => {
        expect(newLoop().extract(newResponse([{}]))).toEqual([{id: '', name: '', input: undefined}]);
    });

    test('gives a sub loop its own session', () => {
        const subLoop = newLoop().createSubLoop();
        expect(subLoop).toBeInstanceOf(OpenAIChatLoop);
        expect(mocks.getSessionDir.mock.calls.at(-1)![3]).toMatchObject({kind: 'sub'});
    });

    test('gives a task loop its own session', () => {
        const taskLoop = newLoop().createTaskLoop({projectId: 'p1', taskTitle: 'ship it'});
        expect(taskLoop).toBeInstanceOf(OpenAIChatLoop);
        expect(mocks.getSessionDir.mock.calls.at(-1)![3]).toMatchObject({kind: 'task'});
    });
});
