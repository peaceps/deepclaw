import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentHandler} from '@deepclaw/core';
import {newTestAgentConfig, newTestAgentHandler} from '../test-support/one-loop-context';
import {type CarriedLoopState} from './definitions/definitions';
import {LoopInitializer} from './loop-initializer';

const mocks = vi.hoisted(() => {
    const constructed: {protocol: string, args: unknown[]}[] = [];
    const loopClass = (protocol: string) => class {
        constructor(...args: unknown[]) {
            constructed.push({protocol, args});
        }
    };
    return {
        constructed,
        loopClass,
        getAgent: vi.fn<(agentId: string) => unknown>(),
        loadAgentConfig: vi.fn<(agentId: string) => unknown>(),
        ensureBaseFiles: vi.fn(),
    };
});

vi.mock('../base-file-initializer', () => ({ensureBaseFiles: mocks.ensureBaseFiles}));
vi.mock('./loop/hooks/hooks', () => ({}));
vi.mock('./loop/services/agent-identity-manager', () => ({
    AgentIdentityManager: {getAgent: mocks.getAgent},
}));
vi.mock('@deepclaw/config', () => ({loadAgentConfig: mocks.loadAgentConfig}));
vi.mock('./loop/loop/anthropic-loop', () => ({AnthropicLoop: mocks.loopClass('Anthropic')}));
vi.mock('./loop/loop/openai-chat-loop', () => ({OpenAIChatLoop: mocks.loopClass('OpenAIChat')}));
vi.mock('./loop/loop/openai-response-loop', () => ({OpenAIResponseLoop: mocks.loopClass('OpenAIResponse')}));

function withBaseURL(baseURL: string) {
    mocks.getAgent.mockReturnValue({id: 'a1', name: 'Ada'});
    mocks.loadAgentConfig.mockReturnValue(newTestAgentConfig({
        llm: {baseURL, apiKey: 'key', model: 'model'},
    }));
}

function getLoop(handler: AgentHandler = newTestAgentHandler() as AgentHandler) {
    return LoopInitializer.getLoop('agent', 'a1', '', handler);
}

describe('LoopInitializer', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.constructed.length = 0;
    });

    test('makes sure the workspace files exist as soon as it is loaded', async () => {
        vi.resetModules();
        await import('./loop-initializer');
        expect(mocks.ensureBaseFiles).toHaveBeenCalled();
    });

    test('refuses to build a loop for an agent that does not exist', () => {
        mocks.getAgent.mockReturnValue(undefined);
        expect(() => getLoop()).toThrow('Agent "a1" not found');
    });

    test('refuses a baseURL it cannot classify', () => {
        withBaseURL('not a url');
        expect(() => getLoop()).toThrow('Invalid agent baseURL: not a url');
    });

    test('builds an anthropic loop for an anthropic endpoint', () => {
        withBaseURL('https://api.anthropic.com');
        getLoop();
        expect(mocks.constructed.map(entry => entry.protocol)).toEqual(['Anthropic']);
    });

    test('builds an openai chat loop for any other endpoint', () => {
        withBaseURL('https://api.openai.com/v1');
        getLoop();
        expect(mocks.constructed.map(entry => entry.protocol)).toEqual(['OpenAIChat']);
    });

    /** Nothing spawned is built here, and nothing is taken over from a loop nobody named. */
    test('hands the loop its role, ids and handler', () => {
        withBaseURL('https://api.openai.com/v1');
        const handler = newTestAgentHandler() as AgentHandler;
        LoopInitializer.getLoop('project', 'a1', 'p1', handler);
        expect(mocks.constructed[0]!.args)
            .toEqual(['project', 'a1', 'p1', handler, undefined, undefined]);
    });

    test('hands on what a loop that was let go of left behind', () => {
        withBaseURL('https://api.openai.com/v1');
        const carried: CarriedLoopState = {
            permissionWhiteList: new Set(['command']), lastInputTokens: 12, footPrints: [],
        };
        LoopInitializer.getLoop(
            'agent', 'a1', '', newTestAgentHandler() as AgentHandler, carried
        );
        expect(mocks.constructed[0]!.args.at(-1)).toBe(carried);
    });

    test('reads the endpoint from the config of that very agent', () => {
        withBaseURL('https://api.openai.com/v1');
        getLoop();
        expect(mocks.loadAgentConfig).toHaveBeenCalledWith('a1');
        expect(mocks.getAgent).toHaveBeenCalledWith('a1');
    });
});
