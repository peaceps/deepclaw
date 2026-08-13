import {describe, expect, test} from 'vitest';
import {type AgentEvent, type ChatMessage} from '@deepclaw/core';
import {
    getClientKey,
    isAgentInfoEvent, isBusyLoopsInfoEvent, isCronInfoEvent, isInfoEvent, isLoopBusyEvent,
    isLoopCancelInteractionEvent, isLoopChatEvent, isLoopEvent, isLoopInteractionEvent,
    isLoopStreamEvent, isLoopTokenUsageEvent, isProjectInfoEvent, isRunningTasksInfoEvent
} from './loop-gateway-types';

const LOOP_ID = 'agent.a1';
const message: ChatMessage = {
    id: 'm1', agentId: 'a1', content: 'hi', type: 'user', timestamp: '2026-01-01T00:00:00.000Z'
};

const events = {
    busy: {eventType: 'busy', loopId: LOOP_ID, busy: true},
    stream: {eventType: 'stream', loopId: LOOP_ID, browserId: 'b1', text: 'hi'},
    interaction: {eventType: 'interaction', loopId: LOOP_ID, browserId: 'b1', type: 'input', content: 'c'},
    cancelInteraction: {eventType: 'cancelInteraction', loopId: LOOP_ID, browserId: 'b1'},
    chat: {eventType: 'chat', loopId: LOOP_ID, browserId: 'b1', update: false, message},
    tokenUsage: {eventType: 'tokenUsage', loopId: LOOP_ID, usage: {
        cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3
    }},
    updateProject: {eventType: 'updateProject', content: {id: 'p1'}},
    updateAgent: {eventType: 'updateAgent', content: {id: 'a1'}},
    updateCron: {eventType: 'updateCron', content: {id: 'c1'}},
    updateRunningTasks: {eventType: 'updateRunningTasks', content: [{projectId: 'p1', taskTitle: 't'}]},
    updateBusyLoops: {eventType: 'updateBusyLoops', content: [LOOP_ID]},
};

function acceptedBy(guard: (event: AgentEvent) => boolean): string[] {
    return Object.entries(events).filter(([, event]) => guard(event as AgentEvent)).map(([name]) => name);
}

describe('event guards', () => {

    test('isLoopBusyEvent matches only busy events', () => {
        expect(acceptedBy(isLoopBusyEvent)).toEqual(['busy']);
    });

    test('isLoopStreamEvent matches only stream events', () => {
        expect(acceptedBy(isLoopStreamEvent)).toEqual(['stream']);
    });

    test('isLoopInteractionEvent matches only interaction events', () => {
        expect(acceptedBy(isLoopInteractionEvent)).toEqual(['interaction']);
    });

    test('isLoopCancelInteractionEvent matches only cancelled interactions', () => {
        expect(acceptedBy(isLoopCancelInteractionEvent)).toEqual(['cancelInteraction']);
    });

    test('isLoopChatEvent matches only chat events', () => {
        expect(acceptedBy(isLoopChatEvent)).toEqual(['chat']);
    });

    test('isLoopTokenUsageEvent matches only token usage events', () => {
        expect(acceptedBy(isLoopTokenUsageEvent)).toEqual(['tokenUsage']);
    });

    test('isProjectInfoEvent matches only project updates', () => {
        expect(acceptedBy(isProjectInfoEvent)).toEqual(['updateProject']);
    });

    test('isAgentInfoEvent matches only agent updates', () => {
        expect(acceptedBy(isAgentInfoEvent)).toEqual(['updateAgent']);
    });

    test('isCronInfoEvent matches only cron updates', () => {
        expect(acceptedBy(isCronInfoEvent)).toEqual(['updateCron']);
    });

    test('isRunningTasksInfoEvent matches only running task updates', () => {
        expect(acceptedBy(isRunningTasksInfoEvent)).toEqual(['updateRunningTasks']);
    });

    test('isBusyLoopsInfoEvent matches only busy loop updates', () => {
        expect(acceptedBy(isBusyLoopsInfoEvent)).toEqual(['updateBusyLoops']);
    });
});

describe('event families', () => {

    test('isLoopEvent covers every event bound to a loop', () => {
        expect(acceptedBy(isLoopEvent))
            .toEqual(['busy', 'stream', 'interaction', 'cancelInteraction', 'chat', 'tokenUsage']);
    });

    /** An event outside both families would be dropped on its way to a browser. */
    test('isInfoEvent covers every data update event', () => {
        expect(acceptedBy(isInfoEvent))
            .toEqual([
                'updateProject', 'updateAgent', 'updateCron', 'updateRunningTasks', 'updateBusyLoops'
            ]);
    });

    test('the two families never overlap', () => {
        for (const sample of Object.values(events)) {
            const event = sample as AgentEvent;
            expect(isLoopEvent(event)).toBe(!isInfoEvent(event));
        }
    });
});

describe('getClientKey', () => {

    test('scopes the browser to a loop when a loopId is given', () => {
        expect(getClientKey('b1', LOOP_ID)).toBe('b1::agent.a1');
    });

    test('falls back to the browserId alone', () => {
        expect(getClientKey('b1')).toBe('b1');
        expect(getClientKey('b1', '')).toBe('b1');
    });

    test('keeps different loops of one browser apart', () => {
        expect(getClientKey('b1', 'agent.a1')).not.toBe(getClientKey('b1', 'agent.a2'));
    });
});
