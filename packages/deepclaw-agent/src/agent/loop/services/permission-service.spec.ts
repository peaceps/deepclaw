import {describe, expect, test, vi} from 'vitest';
import {type FlushAgentRole} from '@deepclaw/core';
import {type ToolGuardResult} from '../../definitions/tool-definitions';
import {PermissionService} from './permission-service';

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

/** The allow list is static, so every test works on its own loopId. */
function ask(
    loopId: string, group: 'command' | 'file' = 'command', role: FlushAgentRole = 'agent'
): ToolGuardResult {
    return PermissionService.askPermissionGuard('rm -rf / ', group, loopId, role);
}

function expectAsk(result: ToolGuardResult) {
    if (result.result !== 'ask') {
        throw new Error(`expected the guard to ask, got ${result.result}`);
    }
    return result;
}

describe('askPermissionGuard', () => {

    test('never bothers a cron run', () => {
        expect(ask('cron.c1', 'command', 'cron')).toEqual({result: 'allowed'});
    });

    test('asks the user with the reason in front of the request', () => {
        const asked = expectAsk(ask('agent.p1'));
        expect(asked.question.content).toBe('rm -rf / agent.tools.permission.request');
        expect(asked.question.type).toBe('select');
    });

    test('offers once, always and deny as the three answers', () => {
        const asked = expectAsk(ask('agent.p2'));
        expect(asked.question.type === 'select' && asked.question.options.map(
            option => typeof option === 'string' ? option : option.value
        )).toEqual(['y', 'a', 'n']);
    });

    test('allows a single run without remembering the choice', () => {
        expect(expectAsk(ask('agent.p3')).checkAnswer('y')).toBe(true);
        expect(ask('agent.p3').result).toBe('ask');
    });

    test('remembers an always answer for the next runs', () => {
        expect(expectAsk(ask('agent.p4')).checkAnswer('a')).toBe(true);
        expect(ask('agent.p4')).toEqual({result: 'allowed'});
    });

    test('denies a no answer', () => {
        expect(expectAsk(ask('agent.p5')).checkAnswer('n')).toBe(false);
        expect(ask('agent.p5').result).toBe('ask');
    });

    test('denies anything that is not an allow answer', () => {
        const asked = expectAsk(ask('agent.p6'));
        expect(asked.checkAnswer('')).toBe(false);
        expect(asked.checkAnswer('maybe')).toBe(false);
    });

    test('reads the answer regardless of case and padding', () => {
        expect(expectAsk(ask('agent.p7')).checkAnswer('  Y  ')).toBe(true);
        expect(expectAsk(ask('agent.p8')).checkAnswer(' A ')).toBe(true);
        expect(ask('agent.p8')).toEqual({result: 'allowed'});
    });

    test('keeps the granted groups apart', () => {
        expect(expectAsk(ask('agent.p9', 'command')).checkAnswer('a')).toBe(true);
        expect(ask('agent.p9', 'command')).toEqual({result: 'allowed'});
        expect(ask('agent.p9', 'file').result).toBe('ask');
    });

    test('keeps the granted loops apart', () => {
        expect(expectAsk(ask('agent.p10', 'file')).checkAnswer('a')).toBe(true);
        expect(ask('agent.p11', 'file').result).toBe('ask');
    });

    test('names the group in the always option', () => {
        const asked = expectAsk(ask('agent.p12', 'file'));
        expect(asked.question.type === 'select' && asked.question.options[1]).toEqual({
            label: 'agent.tools.permission.always', value: 'a'
        });
    });
});
