import {vi} from 'vitest';
import {type AgentRuntime, type FlushAgent, type SealedAgentHandler} from '@deepclaw/core';
import {type AgentConfig} from '@deepclaw/config';
import {type Logger} from '@deepclaw/node-utils';
import {type OneLoopContext} from '../agent/definitions/definitions';

/** Test fixtures for the loop context every tool and service is invoked with. */

export function newTestLogger(): Logger {
    return {
        trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
        warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
        child: vi.fn(),
    } as unknown as Logger;
}

export function newTestRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
    return {
        turnCount: 0,
        historyPersistIndex: 0,
        recoveryState: {maxTokenRetries: 0, refusalState: ''},
        usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        ...overrides,
    };
}

export function newTestAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        id: 'a1',
        name: 'Ada',
        mode: 'agent',
        im: {enabled: false},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
        multimodal: {},
        ...overrides,
    };
}

export function newTestAgentHandler(): SealedAgentHandler {
    return {
        onStreamText: vi.fn(),
        onInteractionEvent: vi.fn(async () => ''),
        onInfoEvent: vi.fn(),
    };
}

export function newTestContext(overrides: Partial<OneLoopContext> = {}): OneLoopContext {
    return {
        role: 'agent',
        agentId: 'a1',
        projectId: '',
        loopId: 'agent.a1',
        browserId: 'b1',
        sessionDir: '.agents/a1/session/s1',
        loopKind: 'main',
        loopConfig: newTestAgentConfig(),
        system: {cacheable: 'cacheable prompt', learned: 'learned prompt', dynamic: 'dynamic prompt'},
        logger: newTestLogger(),
        actions: {
            newTaskLoop: vi.fn(() => ({} as FlushAgent)),
            newSubLoop: vi.fn(() => ({} as FlushAgent)),
            addFootPrint: vi.fn(),
            agentHandler: newTestAgentHandler(),
            addStringMessage: vi.fn(),
        },
        runtime: newTestRuntime(),
        ...overrides,
    };
}
