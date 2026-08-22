import {describe, expect, test, vi} from 'vitest';
import {type ToolGuardResult} from '../../definitions/tool-definitions';
import {type PermissionGroup, type PermissionWhiteList} from '../../definitions/definitions';
import {PermissionService} from './permission-service';

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

/** The list belongs to the conversation, so a test that grants anything brings one of its own. */
function ask(
    whiteList: PermissionWhiteList = new Set(),
    group: PermissionGroup = 'command',
): ToolGuardResult {
    return PermissionService.askPermissionGuard('rm -rf /', group, whiteList);
}

function expectAsk(result: ToolGuardResult) {
    if (result.result !== 'ask') {
        throw new Error(`expected the guard to ask, got ${result.result}`);
    }
    return result;
}

describe('askPermissionGuard', () => {

    /**
     * The reason is joined verbatim: whatever separates it from the request belongs to the
     * translation, which is where each language spells its own (see the agent en bundle).
     */
    test('asks the user with the reason in front of the request', () => {
        const asked = expectAsk(ask());
        expect(asked.question.content).toBe('rm -rf /agent.tools.permission.request');
        expect(asked.question.type).toBe('select');
    });

    test('offers once, always and deny as the three answers', () => {
        const asked = expectAsk(ask());
        expect(asked.question.type === 'select' && asked.question.options.map(
            option => typeof option === 'string' ? option : option.value
        )).toEqual(['y', 'a', 'n']);
    });

    test('allows a single run without remembering the choice', () => {
        const whiteList: PermissionWhiteList = new Set();
        expect(expectAsk(ask(whiteList)).checkAnswer('y')).toBe(true);
        expect(ask(whiteList).result).toBe('ask');
    });

    test('remembers an always answer for the next runs', () => {
        const whiteList: PermissionWhiteList = new Set();
        expect(expectAsk(ask(whiteList)).checkAnswer('a')).toBe(true);
        expect(ask(whiteList)).toEqual({result: 'allowed'});
    });

    test('denies a no answer', () => {
        const whiteList: PermissionWhiteList = new Set();
        expect(expectAsk(ask(whiteList)).checkAnswer('n')).toBe(false);
        expect(ask(whiteList).result).toBe('ask');
    });

    test('denies anything that is not an allow answer', () => {
        const asked = expectAsk(ask());
        expect(asked.checkAnswer('')).toBe(false);
        expect(asked.checkAnswer('maybe')).toBe(false);
    });

    test('reads the answer regardless of case and padding', () => {
        const whiteList: PermissionWhiteList = new Set();
        expect(expectAsk(ask()).checkAnswer('  Y  ')).toBe(true);
        expect(expectAsk(ask(whiteList)).checkAnswer(' A ')).toBe(true);
        expect(ask(whiteList)).toEqual({result: 'allowed'});
    });

    test('keeps the granted groups apart', () => {
        const whiteList: PermissionWhiteList = new Set();
        expect(expectAsk(ask(whiteList, 'command')).checkAnswer('a')).toBe(true);
        expect(ask(whiteList, 'command')).toEqual({result: 'allowed'});
        expect(ask(whiteList, 'file').result).toBe('ask');
    });

    /** Nothing is granted anywhere but in the list handed in, one conversation at a time. */
    test('keeps the conversations apart', () => {
        const whiteList: PermissionWhiteList = new Set();
        expect(expectAsk(ask(whiteList, 'file')).checkAnswer('a')).toBe(true);
        expect(ask(new Set(), 'file').result).toBe('ask');
    });

    /** The list is written into, which is how a grant of a spawned loop reaches the loop above it. */
    test('grants into the list it was handed', () => {
        const whiteList: PermissionWhiteList = new Set();
        expectAsk(ask(whiteList, 'file')).checkAnswer('a');
        expect([...whiteList]).toEqual(['file']);
    });

    test('names the group in the always option', () => {
        const asked = expectAsk(ask(new Set(), 'file'));
        expect(asked.question.type === 'select' && asked.question.options[1]).toEqual({
            label: 'agent.tools.permission.always', value: 'a'
        });
    });
});
