import {describe, expect, test} from 'vitest';
import {
    isAgentStopReason, isContinueTransitionReason, isExternalInterruptReason,
    isInternalInterruptReason, isInvalidInteractionReason, isStopTransitionReason
} from './flush-agent-types';

describe('transition reason guards', () => {

    test('isStopTransitionReason accepts only stop reasons', () => {
        expect(isStopTransitionReason('endLoop')).toBe(true);
        expect(isStopTransitionReason('error')).toBe(true);
        expect(isStopTransitionReason('refused')).toBe(true);
        expect(isStopTransitionReason('toolUse')).toBe(false);
        expect(isStopTransitionReason(undefined)).toBe(false);
    });

    test('isContinueTransitionReason accepts only continue reasons', () => {
        expect(isContinueTransitionReason('toolUse')).toBe(true);
        expect(isContinueTransitionReason('maxTokens')).toBe(true);
        expect(isContinueTransitionReason('inputMaxTokens')).toBe(true);
        expect(isContinueTransitionReason('endLoop')).toBe(false);
        expect(isContinueTransitionReason(undefined)).toBe(false);
    });

    test('stop and continue reasons never overlap', () => {
        const reasons = ['endLoop', 'error', 'refused', 'toolUse', 'maxTokens', 'inputMaxTokens'] as const;
        for (const reason of reasons) {
            expect(isStopTransitionReason(reason)).toBe(!isContinueTransitionReason(reason));
        }
    });
});

describe('break reason guards', () => {

    test('isExternalInterruptReason accepts only client side interrupts', () => {
        expect(isExternalInterruptReason('clientLost')).toBe(true);
        expect(isExternalInterruptReason('interactionAfk')).toBe(false);
        expect(isExternalInterruptReason(undefined)).toBe(false);
    });

    test('isInternalInterruptReason accepts only agent side interrupts', () => {
        expect(isInternalInterruptReason('interactionAfk')).toBe(true);
        expect(isInternalInterruptReason('clientLost')).toBe(false);
        expect(isInternalInterruptReason(undefined)).toBe(false);
    });

    test('isAgentStopReason accepts only planned stops', () => {
        expect(isAgentStopReason('projectCreated')).toBe(true);
        expect(isAgentStopReason('taskPause')).toBe(true);
        expect(isAgentStopReason('clientLost')).toBe(false);
        expect(isAgentStopReason(undefined)).toBe(false);
    });

    test('isInvalidInteractionReason accepts only the ways a question went nowhere', () => {
        expect(isInvalidInteractionReason('disconnected')).toBe(true);
        expect(isInvalidInteractionReason('timeout')).toBe(true);
        expect(isInvalidInteractionReason('error')).toBe(true);
        expect(isInvalidInteractionReason('interactionAfk')).toBe(false);
        expect(isInvalidInteractionReason(undefined)).toBe(false);
    });
});
