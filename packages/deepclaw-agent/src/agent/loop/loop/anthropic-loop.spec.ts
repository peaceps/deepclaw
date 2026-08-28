import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentHandler} from '@deepclaw/core';
import {type ToolUseResult} from '../../definitions/tool-definitions';
import {type ThinkingResponse} from '../../llm/anthropic-llm';
import {type SpawnedLoop} from '../../definitions/definitions';
import {newTestAgentConfig, newTestAgentHandler} from '../../../test-support/one-loop-context';
import {AnthropicLoop} from './anthropic-loop';

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
        taskAssigneeId: () => undefined,
    },
}));

vi.mock('../services/session-service', () => ({
    SessionService: {
        getSessionDir: mocks.getSessionDir,
        loadSession: mocks.loadSession,
        updateSessionRuntime: vi.fn(),
        saveHistory: vi.fn(),
        nameSession: vi.fn(),
    },
}));

class TestableAnthropicLoop extends AnthropicLoop {
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
        llm: {baseURL: 'https://api.anthropic.com', apiKey: 'key', model: 'claude'},
    }));
    return new TestableAnthropicLoop('agent', 'a1', '', handler);
}

function newResponse(content: unknown[]): ThinkingResponse {
    return {content} as unknown as ThinkingResponse;
}

/** What the loop last told the session service it was spawning, the session folder is picked by it. */
function spawnedOf(): SpawnedLoop {
    return mocks.getSessionDir.mock.calls.at(-1)?.[3] as SpawnedLoop;
}

describe('AnthropicLoop', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSessionDir.mockReturnValue('.agents/a1/session/s1');
        mocks.loadSession.mockReturnValue({history: [], outdated: false});
    });

    test('speaks the anthropic protocol', () => {
        expect(newLoop().protocol()).toBe('Anthropic');
    });

    test('answers all tool results inside a single user message', () => {
        expect(newLoop().convert([{id: 'tu1', content: 'first'}, {id: 'tu2', content: 'second'}])).toEqual([{
            role: 'user',
            content: [
                {type: 'tool_result', tool_use_id: 'tu1', content: 'first'},
                {type: 'tool_result', tool_use_id: 'tu2', content: 'second'},
            ],
        }]);
    });

    test('reads the tool calls out of the content blocks', () => {
        const response = newResponse([
            {type: 'text', text: 'let me look'},
            {type: 'tool_use', id: 'tu1', name: 'read_file', input: {filePath: 'a.md'}},
        ]);
        expect(newLoop().extract(response)).toEqual([
            {id: 'tu1', name: 'read_file', input: {filePath: 'a.md'}},
        ]);
    });

    test('finds no tool call in a plain answer', () => {
        expect(newLoop().extract(newResponse([{type: 'text', text: 'done'}]))).toEqual([]);
    });

    test('gives a sub loop its own session', () => {
        const loop = newLoop();
        const subLoop = loop.createSubLoop();
        expect(subLoop).toBeInstanceOf(AnthropicLoop);
        expect(mocks.getSessionDir).toHaveBeenLastCalledWith('agent', 'a1', '', {
            kind: 'sub', runId: expect.any(String), assignedTask: undefined,
            permissionWhiteList: expect.any(Set),
        });
    });

    test('gives a task loop its own session', async () => {
        const taskLoop = await newLoop().createTaskLoop({projectId: 'p1', taskId: 'ship-it'});
        expect(taskLoop).toBeInstanceOf(AnthropicLoop);
        expect(mocks.getSessionDir).toHaveBeenLastCalledWith('agent', 'a1', '', {
            kind: 'task', runId: expect.any(String), assignedTask: {projectId: 'p1', taskId: 'ship-it'},
            permissionWhiteList: expect.any(Set),
        });
    });

    /**
     * A permission is answered once for the conversation, so what a loop was allowed is what every
     * loop under it works with, down the whole chain rather than one step of it.
     */
    test('hands the permission list of the loop down every loop it spawns', async () => {
        const loop = newLoop();
        const taskLoop = await loop.createTaskLoop({projectId: 'p1', taskId: 'ship-it'});
        const handedToTask = spawnedOf().permissionWhiteList;
        taskLoop.createSubLoop();
        expect(spawnedOf().permissionWhiteList).toBe(handedToTask);
    });
});
