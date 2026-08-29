import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type LLMProtocol} from '@deepclaw/config';
import {type AgentHandler} from '@deepclaw/core';
import {newTestAgentConfig, newTestAgentHandler} from '../test-support/one-loop-context';
import {type CarriedLoopState, type SpawnedLoop} from './definitions/definitions';
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

function withBaseURL(baseURL: string, protocol?: LLMProtocol) {
    mocks.getAgent.mockReturnValue({id: 'a1', name: 'Ada'});
    mocks.loadAgentConfig.mockReturnValue(newTestAgentConfig({
        llm: {baseURL, apiKey: 'key', model: 'model', protocol},
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

    /**
     * The url is a guess and this is the way past it: an openai-compatible endpoint answering on
     * responses reads as chat completions, and there is nothing in the address to tell them apart.
     */
    test('builds the loop to the protocol the config picked over what the url says', () => {
        withBaseURL('https://api.openai.com/v1', 'OpenAIResponse');
        getLoop();
        expect(mocks.constructed.map(entry => entry.protocol)).toEqual(['OpenAIResponse']);
    });

    /** A pick is enough on its own, the url only ever being read where there is no pick. */
    test('builds the loop for an endpoint it could not have classified itself', () => {
        withBaseURL('https://gateway.internal', 'Anthropic');
        getLoop();
        expect(mocks.constructed.map(entry => entry.protocol)).toEqual(['Anthropic']);
    });

    /** The config file is hand editable, and a protocol we have no loop for is not spoken. */
    test('refuses a picked protocol it has no loop for', () => {
        withBaseURL('https://api.openai.com/v1', 'Gopher' as LLMProtocol);
        expect(() => getLoop()).toThrow('Invalid agent LLM protocol: Gopher');
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

/** Agents of two vendors, so that whose config was read shows in the class that came out. */
function withAgents(endpoints: Record<string, string>): void {
    mocks.getAgent.mockImplementation(
        agentId => endpoints[agentId] ? {id: agentId, name: agentId} : undefined
    );
    mocks.loadAgentConfig.mockImplementation(agentId => newTestAgentConfig({
        id: agentId, llm: {baseURL: endpoints[agentId] ?? '', apiKey: 'key', model: 'model'},
    }));
}

function newSpawnedRun(runAs?: string): SpawnedLoop {
    return {
        kind: 'task', runId: 'r1', assignedTask: {projectId: 'p1', taskId: 'ship-it'},
        runAs, permissionWhiteList: new Set(),
    };
}

describe('LoopInitializer spawning a loop for another loop', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.constructed.length = 0;
    });

    /**
     * The whole reason a spawned loop is built here rather than by the loop spawning it: that one
     * can only build its own kind, and the class has to follow the endpoint the work is sent to.
     */
    test('builds it to the protocol of the agent whose model does the work', () => {
        withAgents({a1: 'https://api.openai.com/v1', a2: 'https://api.anthropic.com'});
        const handler = newTestAgentHandler() as AgentHandler;
        const spawned = newSpawnedRun('a2');
        LoopInitializer.getSpawnedLoop('project', 'a1', 'p1', handler, spawned);
        expect(mocks.constructed).toEqual([
            {protocol: 'Anthropic', args: ['project', 'a1', 'p1', handler, spawned]}
        ]);
    });

    /** One endpoint, two agents: nothing but the pick can account for the class that came out. */
    test('builds it to the protocol the config of that agent picked', () => {
        mocks.getAgent.mockImplementation(agentId => ({id: agentId, name: agentId}));
        mocks.loadAgentConfig.mockImplementation(agentId => newTestAgentConfig({
            id: agentId,
            llm: {
                baseURL: 'https://api.openai.com/v1', apiKey: 'key', model: 'model',
                protocol: agentId === 'a2' ? 'OpenAIResponse' : undefined,
            },
        }));
        LoopInitializer.getSpawnedLoop(
            'project', 'a1', 'p1', newTestAgentHandler() as AgentHandler, newSpawnedRun('a2')
        );
        expect(mocks.constructed.map(entry => entry.protocol)).toEqual(['OpenAIResponse']);
    });

    test('builds it to the protocol of the loop that spawned it where it names no other agent', () => {
        withAgents({a1: 'https://api.anthropic.com'});
        LoopInitializer.getSpawnedLoop(
            'project', 'a1', 'p1', newTestAgentHandler() as AgentHandler, newSpawnedRun()
        );
        expect(mocks.constructed.map(entry => entry.protocol)).toEqual(['Anthropic']);
    });

    /** A task left with somebody who has since been deleted: the board keeps the name either way. */
    test('refuses to build a run for an agent that does not work here', () => {
        withAgents({a1: 'https://api.openai.com/v1'});
        expect(() => LoopInitializer.getSpawnedLoop(
            'project', 'a1', 'p1', newTestAgentHandler() as AgentHandler, newSpawnedRun('ghost')
        )).toThrow('Agent "ghost" not found');
    });

    /** The likelier of the two by far: the assignee is there, and its endpoint is a typo. */
    test('refuses an assignee whose endpoint names no protocol we speak', () => {
        withAgents({a1: 'https://api.openai.com/v1', a2: 'not a url'});
        expect(() => LoopInitializer.getSpawnedLoop(
            'project', 'a1', 'p1', newTestAgentHandler() as AgentHandler, newSpawnedRun('a2')
        )).toThrow('Invalid agent baseURL: not a url');
    });
});
