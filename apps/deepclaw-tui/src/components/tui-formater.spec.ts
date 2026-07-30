import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type TFunction} from '@deepclaw/i18n';
import {handleTaggedStream} from './tui-formater';

const TAG = 'update_task_current_step';
const CURRENT_KEY = 'tui.tools.updateTaskSteps.current';
const COMPLETED_KEY = 'tui.tools.updateTaskSteps.completed';

const translate = vi.fn(
    (key: string, options?: Record<string, unknown>) => `${key}(${JSON.stringify(options ?? {})})`,
);

/** The module only forwards keys, so a recording stand-in is enough for every assertion. */
const t = translate as unknown as TFunction<'translation', undefined>;

function payload(steps: string[], currentStepIndex: number): string {
    return JSON.stringify({steps, currentStepIndex});
}

/** The lines the formatter handed to the `current` template, one per rendered row. */
function renderedLines(): string[] {
    const call = translate.mock.calls.find(([key]) => key === CURRENT_KEY);
    return String(call![1]!['steps']).split('\n');
}

beforeEach(() => {
    translate.mockClear();
    translate.mockImplementation((key, options) => `${key}(${JSON.stringify(options ?? {})})`);
});

describe('handleTaggedStream', () => {

    test('marks every step by its position around the current one', () => {
        handleTaggedStream(TAG, payload(['plan', 'build', 'ship'], 1), t);
        expect(renderedLines().slice(0, 3)).toEqual(['[√] plan', '[>] build', '[ ] ship']);
    });

    test('marks every step as pending when no step started yet', () => {
        handleTaggedStream(TAG, payload(['plan', 'build'], -1), t);
        expect(renderedLines().slice(0, 2)).toEqual(['[ ] plan', '[ ] build']);
    });

    test('marks every step as completed when the current index is past the last step', () => {
        handleTaggedStream(TAG, payload(['plan', 'build'], 2), t);
        expect(renderedLines().slice(0, 2)).toEqual(['[√] plan', '[√] build']);
    });

    test('counts the steps before the current one as the completed ones', () => {
        handleTaggedStream(TAG, payload(['plan', 'build', 'ship'], 1), t);
        expect(translate).toHaveBeenCalledWith(COMPLETED_KEY, {completed: 1, total: 3});
    });

    test('appends the counter below the last step', () => {
        handleTaggedStream(TAG, payload(['plan'], 0), t);
        expect(renderedLines()).toEqual(['[>] plan', `${COMPLETED_KEY}({"completed":0,"total":1})`]);
    });

    test('keeps only the counter for an empty step list', () => {
        handleTaggedStream(TAG, payload([], 0), t);
        expect(renderedLines()).toEqual([`${COMPLETED_KEY}({"completed":0,"total":0})`]);
    });

    test('returns what the current step template renders to', () => {
        translate.mockReturnValue('rendered');
        expect(handleTaggedStream(TAG, payload(['plan'], 0), t)).toBe('rendered');
        expect(translate).toHaveBeenLastCalledWith(CURRENT_KEY, {steps: '[>] plan\nrendered'});
    });

    test('returns nothing for text that is not json', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(handleTaggedStream(TAG, 'not json', t)).toBe('');
        expect(translate).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test('returns nothing for an empty text', () => {
        expect(handleTaggedStream(TAG, '', t)).toBe('');
    });

    test('returns nothing when the payload carries no steps', () => {
        expect(handleTaggedStream(TAG, JSON.stringify({currentStepIndex: 0}), t)).toBe('');
        expect(handleTaggedStream(TAG, 'null', t)).toBe('');
        expect(translate).not.toHaveBeenCalled();
    });

    test('returns nothing and warns about a tag it does not know', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(handleTaggedStream('update_task_status', payload(['plan'], 0), t)).toBe('');
        expect(warn).toHaveBeenCalledExactlyOnceWith('Unknown tag: update_task_status');
        expect(translate).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
