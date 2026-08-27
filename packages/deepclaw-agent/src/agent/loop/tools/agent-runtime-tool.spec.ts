import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentIdentity} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {AgentFeelingService} from '../services/agent-feeling-service';
import {AgentIdentityManager} from '../services/agent-identity-manager';
import {updateAgentRuntimeTool} from './agent-runtime-tool';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {ensureFileExist: vi.fn(), readFile: vi.fn(() => ''), writeFile: vi.fn()},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const getAgent = vi.spyOn(AgentIdentityManager, 'getAgent');
const remember = vi.spyOn(AgentFeelingService, 'remember').mockImplementation(() => {});

function newIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
    return {
        id: 'a1',
        avatar: '🐟',
        role: 'engineer',
        personalities: ['calm'],
        emotion: true,
        expertises: ['typescript'],
        name: 'Ada',
        fired: false,
        description: 'the agent who ships',
        ...overrides,
    };
}

describe('updateAgentRuntimeTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        getAgent.mockReturnValue(newIdentity());
    });

    /** Only what just happened is reported: the gateway is what turns it into a standing status. */
    test('announces the mood and the emotion of the running agent', async () => {
        const context = newTestContext();
        const result = await updateAgentRuntimeTool.invoke({mood: 'happy', emotion: 'this is fun'}, context);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateAgentRuntime',
            content: {agentId: 'a1', mood: 'happy', emotion: 'this is fun'},
        });
        expect(result).toBe('Agent runtime status updated successfully');
    });

    test('announces an emotion that comes without a mood', async () => {
        const context = newTestContext();
        await updateAgentRuntimeTool.invoke({emotion: 'the fresh one'}, context);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateAgentRuntime',
            content: {agentId: 'a1', mood: undefined, emotion: 'the fresh one'},
        });
    });

    test('announces a mood that comes without an emotion', async () => {
        const context = newTestContext();
        await updateAgentRuntimeTool.invoke({mood: 'tired'}, context);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateAgentRuntime',
            content: {agentId: 'a1', mood: 'tired', emotion: undefined},
        });
    });

    /** A sub loop borrows the name of the assignee, but the mood belongs to whoever runs the loop. */
    test('reports the mood of the agent running the loop, not of the one it stands in for', async () => {
        const context = newTestContext({agentId: 'a1', personaId: 'a2'});
        await updateAgentRuntimeTool.invoke({mood: 'focused'}, context);
        expect(getAgent).toHaveBeenCalledExactlyOnceWith('a1');
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledWith(
            expect.objectContaining({content: expect.objectContaining({agentId: 'a1'})})
        );
    });

    /**
     * The card that went up is out of the run's sight from here on, and the prompt is what shows it
     * back: what the browsers were told and what the run is told it said have to be the one thing.
     */
    test('keeps what it said where the prompt can show it back', async () => {
        const context = newTestContext();
        await updateAgentRuntimeTool.invoke({mood: 'happy', emotion: 'this is fun'}, context);
        expect(remember).toHaveBeenCalledExactlyOnceWith('a1', {mood: 'happy', emotion: 'this is fun'});
        // The one call, and the same words in both places. Two copies of a feeling that drift are
        // a run corrected over something the user never read.
        const {content} = vi.mocked(context.actions.agentHandler.onInfoEvent).mock.calls[0]![0] as
            {content: {agentId: string; mood?: string; emotion?: string}};
        expect(remember).toHaveBeenCalledWith(content.agentId, {
            mood: content.mood, emotion: content.emotion
        });
    });

    test('keeps it under the agent running the loop, not the one it stands in for', async () => {
        await updateAgentRuntimeTool.invoke({mood: 'focused'}, newTestContext({agentId: 'a1', personaId: 'a2'}));
        expect(remember).toHaveBeenCalledExactlyOnceWith('a1', {mood: 'focused', emotion: undefined});
    });

    test('says there is nothing to do when the call carries neither mood nor emotion', async () => {
        const context = newTestContext();
        const result = await updateAgentRuntimeTool.invoke({}, context);
        expect(result).toBe('Nothing to update: neither mood nor emotion is provided.');
        expect(context.actions.agentHandler.onInfoEvent).not.toHaveBeenCalled();
        expect(remember).not.toHaveBeenCalled();
    });

    test('keeps quiet for a scheduled run, whatever it thinks it feels', async () => {
        const context = newTestContext({role: 'cron'});
        const result = await updateAgentRuntimeTool.invoke({mood: 'tired', emotion: 'late shift'}, context);
        expect(result).toBe('A cron run carries no mood of its own, so there is nothing to update.');
        expect(context.actions.agentHandler.onInfoEvent).not.toHaveBeenCalled();
        expect(remember).not.toHaveBeenCalled();
    });

    test('keeps quiet for an agent whose emotions are switched off', async () => {
        getAgent.mockReturnValue(newIdentity({emotion: false}));
        const context = newTestContext();
        const result = await updateAgentRuntimeTool.invoke({mood: 'happy'}, context);
        expect(result).toBe('Agent a1 has emotions switched off, so there is nothing to update.');
        expect(context.actions.agentHandler.onInfoEvent).not.toHaveBeenCalled();
        expect(remember).not.toHaveBeenCalled();
    });

    test('keeps quiet for an agent nobody knows', async () => {
        getAgent.mockReturnValue(undefined);
        const context = newTestContext();
        const result = await updateAgentRuntimeTool.invoke({emotion: 'lost'}, context);
        expect(result).toContain('nothing to update');
        expect(context.actions.agentHandler.onInfoEvent).not.toHaveBeenCalled();
    });
});

describe('updateAgentRuntimeTool metadata', () => {

    test('runs next to other calls in both modes but never inside a sub loop', () => {
        expect(updateAgentRuntimeTool.parallelSafe).toBe(true);
        expect(updateAgentRuntimeTool.loopKinds).toEqual(['main']);
        expect(updateAgentRuntimeTool.agentMode).toEqual(['agent', 'chat']);
    });

    test('asks for nothing, so the agent can send a mood and an emotion apart', () => {
        expect(updateAgentRuntimeTool.tool.schema.required).toEqual([]);
        expect(updateAgentRuntimeTool.tool.schema).toMatchObject({
            properties: {mood: {enum: ['happy', 'focused', 'tired', 'confused', 'none']}},
        });
    });
});
