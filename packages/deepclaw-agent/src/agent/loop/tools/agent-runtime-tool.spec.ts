import {beforeEach, describe, expect, test, vi} from 'vitest';
import {AGENT_CONFIG, type AgentIdentity} from '@deepclaw/core';
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

    /** Nothing is borrowed in a conversation, so the name on the run is the name on the card. */
    test('reports the mood of the agent whose conversation this is', async () => {
        const context = newTestContext({agentId: 'a1', personaId: 'a2'});
        await updateAgentRuntimeTool.invoke({mood: 'focused'}, context);
        expect(getAgent).toHaveBeenCalledExactlyOnceWith('a1');
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledWith(
            expect.objectContaining({content: expect.objectContaining({agentId: 'a1'})})
        );
    });

    /**
     * A task is worked as the agent it belongs to: their model answers, their memory and skills are
     * around it, their name is what the prompt gives it. The feeling is theirs on the same grounds,
     * and the card the user watches is the one they would look at to see how that work is going.
     */
    test('reports the mood of the agent a task is worked as, not of the loop that handed it over', async () => {
        getAgent.mockReturnValue(newIdentity({id: 'a2', name: 'Bob'}));
        const context = newTestContext({loopKind: 'task', agentId: 'a1', personaId: 'a2'});
        await updateAgentRuntimeTool.invoke({mood: 'focused', emotion: 'a long one'}, context);
        expect(getAgent).toHaveBeenCalledExactlyOnceWith('a2');
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateAgentRuntime',
            content: {agentId: 'a2', mood: 'focused', emotion: 'a long one'},
        });
        expect(remember).toHaveBeenCalledExactlyOnceWith('a2', {mood: 'focused', emotion: 'a long one'});
    });

    /**
     * A task nobody owns is worked under no name at all: the prompt gives it none, and the card of
     * the loop that spawned it belongs to a run the user is watching rather than to this one.
     */
    test('keeps quiet where it works a task in nobody\'s name', async () => {
        const context = newTestContext({loopKind: 'task', agentId: 'a1'});
        const result = await updateAgentRuntimeTool.invoke({mood: 'tired'}, context);
        expect(result).toBe('This run works in nobody\'s name, so there is no mood of anyone\'s to update.');
        expect(getAgent).not.toHaveBeenCalled();
        expect(context.actions.agentHandler.onInfoEvent).not.toHaveBeenCalled();
        expect(remember).not.toHaveBeenCalled();
    });

    /**
     * The tool is kept from sub loops by its loopKinds, so this is the same answer read off the
     * context: a piece of a task is not the task, and several pieces run under that one name at
     * once would leave one card written by all of them.
     */
    test('keeps quiet inside a sub loop of a task, borrowed name and all', async () => {
        const context = newTestContext({loopKind: 'sub', agentId: 'a1', personaId: 'a2'});
        const result = await updateAgentRuntimeTool.invoke({emotion: 'nearly there'}, context);
        expect(result).toContain('works in nobody\'s name');
        expect(context.actions.agentHandler.onInfoEvent).not.toHaveBeenCalled();
        expect(remember).not.toHaveBeenCalled();
    });

    /** The switch is the assignee's to set, this being their card and their feeling. */
    test('keeps quiet where the agent a task is worked as has emotions switched off', async () => {
        getAgent.mockReturnValue(newIdentity({id: 'a2', emotion: false}));
        const context = newTestContext({loopKind: 'task', agentId: 'a1', personaId: 'a2'});
        const result = await updateAgentRuntimeTool.invoke({mood: 'happy'}, context);
        expect(result).toBe('Agent a2 has emotions switched off, so there is nothing to update.');
        expect(remember).not.toHaveBeenCalled();
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

    test('keeps it under the agent whose conversation this is', async () => {
        await updateAgentRuntimeTool.invoke({mood: 'focused'}, newTestContext({agentId: 'a1', personaId: 'a2'}));
        expect(remember).toHaveBeenCalledExactlyOnceWith('a1', {mood: 'focused', emotion: undefined});
    });

    /**
     * The length is asked for in words in three places and promised by none of them. What arrives
     * longer is cut here rather than on the card, so that both copies of it are the one string.
     */
    test('cuts a feeling too long for the bubble to hold', async () => {
        const context = newTestContext();
        const long = 'task-7 closed, task-8 is out for review now';
        const result = await updateAgentRuntimeTool.invoke({emotion: long}, context);
        const kept = long.slice(0, AGENT_CONFIG.maxEmotionLength);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateAgentRuntime',
            content: {agentId: 'a1', mood: undefined, emotion: kept},
        });
        expect(remember).toHaveBeenCalledExactlyOnceWith('a1', {mood: undefined, emotion: kept});
        expect(result).toContain('kept to its first 30 characters');
    });

    /** Told, because the prompt shows the feeling back and a run reads a short one as somebody's. */
    test('says nothing of a cut where the feeling fitted', async () => {
        const result = await updateAgentRuntimeTool.invoke({emotion: 'this is fun'}, newTestContext());
        expect(result).toBe('Agent runtime status updated successfully');
    });

    /** A bubble of three spaces is the latest thing that agent felt until it feels another. */
    test('reads a feeling of nothing but spaces as no feeling at all', async () => {
        const context = newTestContext();
        const result = await updateAgentRuntimeTool.invoke({emotion: '   '}, context);
        expect(result).toBe('Nothing to update: neither mood nor emotion is provided.');
        expect(context.actions.agentHandler.onInfoEvent).not.toHaveBeenCalled();
        expect(remember).not.toHaveBeenCalled();
    });

    test('trims a feeling that came with room around it', async () => {
        const context = newTestContext();
        await updateAgentRuntimeTool.invoke({mood: 'tired', emotion: '  late shift  '}, context);
        expect(remember).toHaveBeenCalledExactlyOnceWith('a1', {mood: 'tired', emotion: 'late shift'});
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

    test('runs next to other calls in both modes, in a conversation or on a task', () => {
        expect(updateAgentRuntimeTool.parallelSafe).toBe(true);
        expect(updateAgentRuntimeTool.loopKinds).toEqual(['main', 'task']);
        expect(updateAgentRuntimeTool.agentMode).toEqual(['agent', 'chat']);
    });

    test('asks for nothing, so the agent can send a mood and an emotion apart', () => {
        expect(updateAgentRuntimeTool.tool.schema.required).toEqual([]);
        expect(updateAgentRuntimeTool.tool.schema).toMatchObject({
            properties: {mood: {enum: ['happy', 'focused', 'tired', 'confused', 'none']}},
        });
    });

    /** Asked for at the same length it is cut at, so a model is not turned down for obeying. */
    test('asks for a feeling no longer than the one it keeps', () => {
        expect(updateAgentRuntimeTool.tool.schema).toMatchObject({
            properties: {emotion: {maxLength: AGENT_CONFIG.maxEmotionLength}},
        });
    });
});
