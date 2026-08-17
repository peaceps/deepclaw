import {describe, expect, test} from 'vitest';
import {AgentRuntimeService, MAX_EMOTIONS} from './agent-runtime-service';

/** The service is meant to outlive a single run, so every test here works on an agent of its own. */
describe('AgentRuntimeService', () => {

    test('feels nothing for an agent that never said anything', () => {
        expect(AgentRuntimeService.getStatus('quiet')).toEqual({mood: 'none', emotions: []});
    });

    test('remembers the mood it was handed', () => {
        expect(AgentRuntimeService.update('moody', 'happy')).toEqual({mood: 'happy', emotions: []});
        expect(AgentRuntimeService.getStatus('moody')).toEqual({mood: 'happy', emotions: []});
    });

    test('keeps the emotions in the order they arrived', () => {
        AgentRuntimeService.update('talker', undefined, 'this is fun');
        const status = AgentRuntimeService.update('talker', undefined, 'now it is not');
        expect(status.emotions).toEqual(['this is fun', 'now it is not']);
    });

    test('leaves the mood alone while only an emotion comes in', () => {
        AgentRuntimeService.update('steady', 'focused');
        expect(AgentRuntimeService.update('steady', undefined, 'still at it').mood).toBe('focused');
    });

    test('leaves the emotions alone while only a mood comes in', () => {
        AgentRuntimeService.update('shifty', 'happy', 'a good start');
        expect(AgentRuntimeService.update('shifty', 'tired').emotions).toEqual(['a good start']);
    });

    test('drops the oldest emotion once the list is full', () => {
        for (let i = 0; i < MAX_EMOTIONS + 3; i++) {
            AgentRuntimeService.update('chatty', undefined, `feeling ${i}`);
        }
        const {emotions} = AgentRuntimeService.getStatus('chatty');
        expect(emotions).toHaveLength(MAX_EMOTIONS);
        expect(emotions?.at(0)).toBe('feeling 3');
        expect(emotions?.at(-1)).toBe(`feeling ${MAX_EMOTIONS + 2}`);
    });

    test('holds the feelings of two agents apart', () => {
        AgentRuntimeService.update('one', 'happy', 'mine');
        AgentRuntimeService.update('two', 'tired', 'ours');
        expect(AgentRuntimeService.getStatus('one')).toEqual({mood: 'happy', emotions: ['mine']});
        expect(AgentRuntimeService.getStatus('two')).toEqual({mood: 'tired', emotions: ['ours']});
    });

    /** The neutral status is built on the spot, so a caller cannot poison the next agent with it. */
    test('hands every newcomer its own neutral status', () => {
        AgentRuntimeService.getStatus('newcomer').emotions!.push('not mine');
        expect(AgentRuntimeService.getStatus('another')).toEqual({mood: 'none', emotions: []});
    });
});
