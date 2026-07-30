import {afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentInteractionEvent, type AgentInteractionEventPayload} from '@deepclaw/core';
import {DEFAULT_LANG, i18nInstance, init, mergeResources, SUPPORTED_LANGUAGES} from '@deepclaw/i18n';
import './i18n/index';
import {
    handleStringifiedInteractionEvent, parseStringifiedAnswer, stringifiedInteractionEvent
} from './stringified-event';

const mocks = vi.hoisted(() => {
    const question = vi.fn<(prompt: string) => Promise<string>>(async () => '');
    const close = vi.fn();
    const createInterface = vi.fn(() => ({question, close}));
    return {question, close, createInterface};
});

vi.mock('readline/promises', () => ({
    default: {createInterface: mocks.createInterface},
    createInterface: mocks.createInterface,
}));

const SELECT_HINT = 'Please respond the index number: ';
const INVALID_HINT = 'Invalid option, please try again.';

function newEvent(payload: AgentInteractionEventPayload): AgentInteractionEvent {
    return {eventType: 'interaction', loopId: 'agent.a1', browserId: 'b1', ...payload};
}

beforeAll(() => {
    mergeResources({
        en: {spec: {
            prompt: 'What is your name?',
            optionA: 'Option A',
            optionB: 'Option B',
            withParam: 'Hi {{name}}',
        }},
    });
    init('en');
});

describe('stringifiedInteractionEvent', () => {

    test('appends a space after an input prompt', () => {
        expect(stringifiedInteractionEvent({type: 'input', content: 'spec.prompt'}))
            .toBe('What is your name? ');
    });

    test('returns a readonly prompt untouched', () => {
        expect(stringifiedInteractionEvent({type: 'readonly', content: 'spec.prompt'}))
            .toBe('What is your name?');
    });

    test('interpolates the i18n parameters', () => {
        expect(stringifiedInteractionEvent({
            type: 'readonly', content: 'spec.withParam', i18nParam: {name: 'Ada'}
        })).toBe('Hi Ada');
    });

    test('numbers the options of a select prompt and asks for an index', () => {
        expect(stringifiedInteractionEvent({
            type: 'select',
            content: 'spec.prompt',
            options: [{label: 'spec.optionA', value: 'a'}, {label: 'spec.optionB', value: 'b'}],
        })).toBe(`What is your name?\n[1] Option A\n[2] Option B\n${SELECT_HINT}`);
    });

    test('translates plain string options as well', () => {
        expect(stringifiedInteractionEvent({
            type: 'select', content: 'spec.prompt', options: ['spec.optionA'],
        })).toBe(`What is your name?\n[1] Option A\n${SELECT_HINT}`);
    });

    test('keeps an option label that has no translation', () => {
        expect(stringifiedInteractionEvent({
            type: 'select', content: 'spec.prompt', options: ['Plain label'],
        })).toBe(`What is your name?\n[1] Plain label\n${SELECT_HINT}`);
    });
});

describe('parseStringifiedAnswer', () => {
    const notify = vi.fn();
    const callSelf = vi.fn(async () => 'retried');

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const selectEvent = newEvent({
        type: 'select',
        content: 'spec.prompt',
        options: [{label: 'spec.optionA', value: 'a'}, {label: 'spec.optionB', value: 'b'}],
    });

    test('returns the raw answer for an input prompt', async () => {
        const event = newEvent({type: 'input', content: 'spec.prompt'});
        expect(await parseStringifiedAnswer(event, 'Ada', notify, callSelf)).toBe('Ada');
        expect(notify).not.toHaveBeenCalled();
        expect(callSelf).not.toHaveBeenCalled();
    });

    test('maps the index to the value of the selected option', async () => {
        expect(await parseStringifiedAnswer(selectEvent, '1', notify, callSelf)).toBe('a');
        expect(await parseStringifiedAnswer(selectEvent, '2', notify, callSelf)).toBe('b');
    });

    test('uses a plain string option as its own value', async () => {
        const event = newEvent({type: 'select', content: 'spec.prompt', options: ['zh', 'en']});
        expect(await parseStringifiedAnswer(event, '2', notify, callSelf)).toBe('en');
    });

    test('asks again when the index is out of range', async () => {
        expect(await parseStringifiedAnswer(selectEvent, '3', notify, callSelf)).toBe('retried');
        expect(notify).toHaveBeenCalledWith(INVALID_HINT);
        expect(callSelf).toHaveBeenCalledWith(selectEvent);
    });

    test('asks again for a zero or negative index', async () => {
        expect(await parseStringifiedAnswer(selectEvent, '0', notify, callSelf)).toBe('retried');
        expect(await parseStringifiedAnswer(selectEvent, '-1', notify, callSelf)).toBe('retried');
        expect(callSelf).toHaveBeenCalledTimes(2);
    });

    test('asks again when the answer is not a number', async () => {
        expect(await parseStringifiedAnswer(selectEvent, 'first', notify, callSelf)).toBe('retried');
        expect(callSelf).toHaveBeenCalledOnce();
    });

    test('asks again on an empty answer', async () => {
        expect(await parseStringifiedAnswer(selectEvent, '', notify, callSelf)).toBe('retried');
        expect(callSelf).toHaveBeenCalledOnce();
    });
});

describe('handleStringifiedInteractionEvent', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('prints a readonly prompt without asking anything', async () => {
        const answer = await handleStringifiedInteractionEvent(newEvent({
            type: 'readonly', content: 'spec.prompt'
        }));
        expect(answer).toBe('');
        expect(console.log).toHaveBeenCalledWith('What is your name?');
        expect(mocks.question).not.toHaveBeenCalled();
    });

    test('returns what the user typed for an input prompt', async () => {
        mocks.question.mockResolvedValueOnce('Ada');
        const answer = await handleStringifiedInteractionEvent(newEvent({
            type: 'input', content: 'spec.prompt'
        }));
        expect(mocks.question).toHaveBeenCalledWith('What is your name? ');
        expect(answer).toBe('Ada');
    });

    test('closes the readline interface once the prompt is answered', async () => {
        mocks.question.mockResolvedValueOnce('Ada');
        await handleStringifiedInteractionEvent(newEvent({type: 'input', content: 'spec.prompt'}));
        expect(mocks.close).toHaveBeenCalled();
    });

    test('re-asks a select prompt until the answer is valid', async () => {
        mocks.question.mockResolvedValueOnce('9').mockResolvedValueOnce('2');
        const answer = await handleStringifiedInteractionEvent(newEvent({
            type: 'select',
            content: 'spec.prompt',
            options: [{label: 'spec.optionA', value: 'a'}, {label: 'spec.optionB', value: 'b'}],
        }));
        expect(mocks.question).toHaveBeenCalledTimes(2);
        expect(console.log).toHaveBeenCalledWith(INVALID_HINT);
        expect(answer).toBe('b');
    });

    test('switches the language when the answer of a lang prompt differs from the default', async () => {
        const other = SUPPORTED_LANGUAGES.find(lang => lang !== DEFAULT_LANG)!;
        const changeLanguage = vi.spyOn(i18nInstance, 'changeLanguage')
            .mockImplementation(() => Promise.resolve(i18nInstance.t) as ReturnType<typeof i18nInstance.changeLanguage>);
        mocks.question.mockResolvedValueOnce('1');
        const answer = await handleStringifiedInteractionEvent(newEvent({
            key: 'lang', type: 'select', content: 'spec.prompt', options: [other],
        }));
        expect(answer).toBe(other);
        expect(changeLanguage).toHaveBeenCalledWith(other);
    });

    test('keeps the language when the answer already is the default one', async () => {
        const changeLanguage = vi.spyOn(i18nInstance, 'changeLanguage')
            .mockImplementation(() => Promise.resolve(i18nInstance.t) as ReturnType<typeof i18nInstance.changeLanguage>);
        mocks.question.mockResolvedValueOnce('1');
        await handleStringifiedInteractionEvent(newEvent({
            key: 'lang', type: 'select', content: 'spec.prompt', options: [DEFAULT_LANG],
        }));
        expect(changeLanguage).not.toHaveBeenCalled();
    });

    test('closes the readline interface even when the prompt fails', async () => {
        mocks.question.mockRejectedValueOnce(new Error('stdin closed'));
        await expect(handleStringifiedInteractionEvent(newEvent({
            type: 'input', content: 'spec.prompt'
        }))).rejects.toThrow('stdin closed');
        expect(mocks.close).toHaveBeenCalled();
    });
});
