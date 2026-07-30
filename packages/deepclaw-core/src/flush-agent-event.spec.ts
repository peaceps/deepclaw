import {describe, expect, test} from 'vitest';
import {getLoopId, splitLoopId} from './flush-agent-event';

describe('getLoopId', () => {

    test('joins role and agentId when there is no project', () => {
        expect(getLoopId('agent', 'a1')).toBe('agent.a1');
    });

    test('appends the projectId when present', () => {
        expect(getLoopId('project', 'a1', 'p1')).toBe('project.a1.p1');
    });

    test('treats an empty projectId as absent', () => {
        expect(getLoopId('cron', 'a1', '')).toBe('cron.a1');
    });
});

describe('splitLoopId', () => {

    test('splits a loopId without project', () => {
        expect(splitLoopId('agent.a1')).toEqual({role: 'agent', agentId: 'a1', projectId: undefined});
    });

    test('splits a loopId with project', () => {
        expect(splitLoopId('project.a1.p1')).toEqual({role: 'project', agentId: 'a1', projectId: 'p1'});
    });

    test('falls back to an empty agentId when only the role is given', () => {
        expect(splitLoopId('agent')).toEqual({role: 'agent', agentId: '', projectId: undefined});
    });

    test('round trips every loopId shape', () => {
        expect(splitLoopId(getLoopId('agent', 'a1'))).toEqual({role: 'agent', agentId: 'a1', projectId: undefined});
        expect(splitLoopId(getLoopId('cron', 'a1', 'p1'))).toEqual({role: 'cron', agentId: 'a1', projectId: 'p1'});
    });

    test('cannot round trip ids containing the dot separator', () => {
        expect(splitLoopId(getLoopId('agent', 'a.1'))).toEqual({role: 'agent', agentId: 'a', projectId: '1'});
    });
});
