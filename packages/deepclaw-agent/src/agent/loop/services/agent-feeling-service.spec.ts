import {afterEach, describe, expect, test, vi} from 'vitest';
import {AgentFeelingService} from './agent-feeling-service';

/**
 * The service is a singleton and holds one entry per agent, so every test works on an agent of its
 * own rather than on a clean service. Nothing here needs an agent that exists anywhere else.
 */
let agents = 0;

function newAgentId(): string {
    return `a${++agents}`;
}

describe('AgentFeelingService', () => {

    afterEach(() => {
        vi.useRealTimers();
    });

    test('has nothing of an agent that has felt nothing', () => {
        expect(AgentFeelingService.getFeeling(newAgentId())).toBeUndefined();
    });

    test('keeps what an agent said it felt', () => {
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {mood: 'happy', emotion: 'this is fun'});
        expect(AgentFeelingService.getFeeling(agentId))
            .toMatchObject({mood: 'happy', emotion: 'this is fun', turnsSince: 0});
    });

    /** The gateway folds them the same way, so both travel together from either side of it. */
    test('keeps the mood said before an emotion that came without one', () => {
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {mood: 'focused'});
        AgentFeelingService.remember(agentId, {emotion: 'nearly there'});
        expect(AgentFeelingService.getFeeling(agentId))
            .toMatchObject({mood: 'focused', emotion: 'nearly there'});
    });

    test('keeps the emotion said before a mood that came without one', () => {
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {emotion: 'nearly there'});
        AgentFeelingService.remember(agentId, {mood: 'tired'});
        expect(AgentFeelingService.getFeeling(agentId))
            .toMatchObject({mood: 'tired', emotion: 'nearly there'});
    });

    test('holds the feelings of two agents apart', () => {
        const one = newAgentId();
        const other = newAgentId();
        AgentFeelingService.remember(one, {emotion: 'mine'});
        AgentFeelingService.remember(other, {emotion: 'yours'});
        expect(AgentFeelingService.getFeeling(one)?.emotion).toBe('mine');
        expect(AgentFeelingService.getFeeling(other)?.emotion).toBe('yours');
    });

    /** Handed the entry itself, a caller reading a feeling could age or rewrite it from outside. */
    test('hands out a copy of what it holds', () => {
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {emotion: 'mine to keep'});
        const felt = AgentFeelingService.getFeeling(agentId);
        felt!.emotion = 'not any more';
        felt!.turnsSince = 99;
        expect(AgentFeelingService.getFeeling(agentId))
            .toMatchObject({emotion: 'mine to keep', turnsSince: 0});
    });

    test('counts the turns that went by since it was said', () => {
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {emotion: 'fresh'});
        AgentFeelingService.aTurnPassed(agentId);
        AgentFeelingService.aTurnPassed(agentId);
        expect(AgentFeelingService.getFeeling(agentId)?.turnsSince).toBe(2);
    });

    /** Two loops of one agent are one card, so the work of either ages what the other said. */
    test('counts the turns of the agent that felt it and of no other', () => {
        const one = newAgentId();
        const other = newAgentId();
        AgentFeelingService.remember(one, {emotion: 'fresh'});
        AgentFeelingService.remember(other, {emotion: 'also fresh'});
        AgentFeelingService.aTurnPassed(other);
        expect(AgentFeelingService.getFeeling(one)?.turnsSince).toBe(0);
        expect(AgentFeelingService.getFeeling(other)?.turnsSince).toBe(1);
    });

    test('starts the count over where something new was felt', () => {
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {emotion: 'the old one'});
        AgentFeelingService.aTurnPassed(agentId);
        AgentFeelingService.remember(agentId, {emotion: 'the new one'});
        expect(AgentFeelingService.getFeeling(agentId)?.turnsSince).toBe(0);
    });

    test('counts nothing for an agent that has felt nothing to age', () => {
        const agentId = newAgentId();
        expect(() => AgentFeelingService.aTurnPassed(agentId)).not.toThrow();
        expect(AgentFeelingService.getFeeling(agentId)).toBeUndefined();
    });

    test('remembers when it was said', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-27T10:00:00.000Z'));
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {emotion: 'timed'});
        expect(AgentFeelingService.getFeeling(agentId)?.saidAt)
            .toBe(Date.parse('2026-08-27T10:00:00.000Z'));
    });

    test('takes the time of the latest word on it', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-27T10:00:00.000Z'));
        const agentId = newAgentId();
        AgentFeelingService.remember(agentId, {emotion: 'the old one'});
        vi.setSystemTime(new Date('2026-08-27T10:30:00.000Z'));
        AgentFeelingService.remember(agentId, {emotion: 'the new one'});
        expect(AgentFeelingService.getFeeling(agentId)?.saidAt)
            .toBe(Date.parse('2026-08-27T10:30:00.000Z'));
    });

    describe('the asking after it', () => {

        test('has nothing of an agent nobody has asked', () => {
            expect(AgentFeelingService.getAsk(newAgentId())).toBeUndefined();
        });

        test('keeps when the question was put', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-08-27T10:00:00.000Z'));
            const agentId = newAgentId();
            AgentFeelingService.asked(agentId);
            expect(AgentFeelingService.getAsk(agentId))
                .toEqual({askedAt: Date.parse('2026-08-27T10:00:00.000Z'), turnsSince: 0});
        });

        /** Both clocks run off the one turn: what was said ages, and so does the asking after it. */
        test('ages with the turns of the agent', () => {
            const agentId = newAgentId();
            AgentFeelingService.remember(agentId, {emotion: 'fresh'});
            AgentFeelingService.asked(agentId);
            AgentFeelingService.aTurnPassed(agentId);
            expect(AgentFeelingService.getAsk(agentId)?.turnsSince).toBe(1);
            expect(AgentFeelingService.getFeeling(agentId)?.turnsSince).toBe(1);
        });

        test('starts over where the question is put again', () => {
            const agentId = newAgentId();
            AgentFeelingService.asked(agentId);
            AgentFeelingService.aTurnPassed(agentId);
            AgentFeelingService.asked(agentId);
            expect(AgentFeelingService.getAsk(agentId)?.turnsSince).toBe(0);
        });

        test('hands out a copy of that too', () => {
            const agentId = newAgentId();
            AgentFeelingService.asked(agentId);
            AgentFeelingService.getAsk(agentId)!.turnsSince = 99;
            expect(AgentFeelingService.getAsk(agentId)?.turnsSince).toBe(0);
        });

        test('ages an asking of an agent that has felt nothing yet', () => {
            const agentId = newAgentId();
            AgentFeelingService.asked(agentId);
            AgentFeelingService.aTurnPassed(agentId);
            expect(AgentFeelingService.getAsk(agentId)?.turnsSince).toBe(1);
            expect(AgentFeelingService.getFeeling(agentId)).toBeUndefined();
        });
    });
});
