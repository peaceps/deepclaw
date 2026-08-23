import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {ToolUseService} from '../services/tool-use-service';
import {askUserTool} from './ask-user-tool';

const askQuestion = vi.spyOn(ToolUseService, 'askQuestion');

describe('askUserTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        askQuestion.mockResolvedValue('the second one');
    });

    test('has the user pick one of the answers it offers', async () => {
        const context = newTestContext();
        const result = await askUserTool.invoke(
            {question: 'which one?', options: ['the first one', 'the second one']}, context
        );
        expect(askQuestion).toHaveBeenCalledExactlyOnceWith({
            type: 'select', content: 'which one?', options: ['the first one', 'the second one'],
        }, context);
        expect(result).toBe('The user answered: the second one');
    });

    /** Nothing to choose between is nothing to choose from: the user writes the answer instead. */
    test('has the user write the answer when no options come with the question', async () => {
        askQuestion.mockResolvedValue('the one by the door');
        const result = await askUserTool.invoke({question: 'which one?'}, newTestContext());
        expect(askQuestion).toHaveBeenCalledWith({type: 'input', content: 'which one?'}, expect.anything());
        expect(result).toBe('The user answered: the one by the door');
    });

    test('has the user write the answer when only one option came', async () => {
        await askUserTool.invoke({question: 'which one?', options: ['the only one']}, newTestContext());
        expect(askQuestion).toHaveBeenCalledWith({type: 'input', content: 'which one?'}, expect.anything());
    });

    /** The cap is in the schema, and a model that keeps to it is the only one the schema binds. */
    test('puts no more than six answers in front of the user, and says which it left out', async () => {
        askQuestion.mockResolvedValue('two');
        const options = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
        const result = await askUserTool.invoke({question: 'which one?', options}, newTestContext());
        expect(askQuestion).toHaveBeenCalledWith({
            type: 'select', content: 'which one?',
            options: ['one', 'two', 'three', 'four', 'five', 'six'],
        }, expect.anything());
        expect(result).toContain('The user answered: two');
        expect(result).toContain('seven, eight');
    });

    test('says nothing of the answers it left out where it left none out', async () => {
        const result = await askUserTool.invoke(
            {question: 'which one?', options: ['one', 'two']}, newTestContext()
        );
        expect(result).toBe('The user answered: the second one');
    });

    test('drops the blank options and the space around the rest', async () => {
        await askUserTool.invoke(
            {question: '  which one?  ', options: ['  the first one', '   ', 'the second one']},
            newTestContext()
        );
        expect(askQuestion).toHaveBeenCalledWith({
            type: 'select', content: 'which one?', options: ['the first one', 'the second one'],
        }, expect.anything());
    });

    test('asks nobody when the question is blank', async () => {
        const result = await askUserTool.invoke({question: '   '}, newTestContext());
        expect(askQuestion).not.toHaveBeenCalled();
        expect(result).toBe('Nothing was asked: a question is needed to ask one.');
    });

    test('asks nobody when the call carries no question at all', async () => {
        const result = await askUserTool.invoke({} as {question: string}, newTestContext());
        expect(askQuestion).not.toHaveBeenCalled();
        expect(result).toBe('Nothing was asked: a question is needed to ask one.');
    });

    /** Whoever set the schedule up is not sitting in front of it when it runs. */
    test('asks nobody in a scheduled run', async () => {
        const result = await askUserTool.invoke(
            {question: 'which one?'}, newTestContext({role: 'cron'})
        );
        expect(askQuestion).not.toHaveBeenCalled();
        expect(result).toContain('This run was scheduled, so there is nobody to ask.');
    });

    test('reports a question nobody answered in time', async () => {
        askQuestion.mockRejectedValue('interactionAfk');
        const result = await askUserTool.invoke({question: 'which one?'}, newTestContext());
        expect(result).toContain('Nobody answered in time');
    });

    test('reports a question that reached nobody', async () => {
        askQuestion.mockRejectedValue('disconnected');
        const result = await askUserTool.invoke({question: 'which one?'}, newTestContext());
        expect(result).toContain('There is nobody to ask right now');
    });

    test('reports an answer the user closed the question without giving', async () => {
        askQuestion.mockResolvedValue('  ');
        const result = await askUserTool.invoke({question: 'which one?'}, newTestContext());
        expect(result).toBe('The user closed the question without answering it.');
    });

    test('reports what else went wrong with the asking', async () => {
        askQuestion.mockRejectedValue(new Error('the socket died'));
        const result = await askUserTool.invoke({question: 'which one?'}, newTestContext());
        expect(result).toBe('Asking failed: Error: the socket died');
    });
});

describe('askUserTool metadata', () => {

    /** The run stands still in front of the question, so nothing else of it may be running. */
    test('runs alone, in agent mode, in every kind of loop', () => {
        expect(askUserTool.parallelSafe).toBe(false);
        expect(askUserTool.agentMode).toEqual(['agent']);
        expect(askUserTool.loopKinds).toBeUndefined();
    });

    test('asks for a question and takes the answers to offer as an extra', () => {
        expect(askUserTool.tool.schema.required).toEqual(['question']);
        expect(askUserTool.tool.schema).toMatchObject({
            properties: {options: {minItems: 2, maxItems: 6}},
        });
    });
});
