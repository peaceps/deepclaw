import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {ResponseInputItem} from 'openai/resources/responses/responses';
import type {ThinkingMessage} from '../../llm/openai-response-llm';
import {newTestContext} from '../../../test-support/one-loop-context';
import {OpenAIResponseMessagesCompactor} from './openai-response-compactor';

vi.mock('@deepclaw/i18n', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/i18n')>()),
    i18nInstance: {t: (key: string) => key},
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const COMPACTED = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';

type FunctionCallOutput = ResponseInputItem.FunctionCallOutput;

class TestableOpenAIResponseCompactor extends OpenAIResponseMessagesCompactor {

    public resultsOf(messages: ThinkingMessage[]): FunctionCallOutput[] {
        return this.getToolResults(messages);
    }

    public lengthOf(toolResult: FunctionCallOutput): number {
        return this.getContentLength(toolResult);
    }

    public compact(toolResult: FunctionCallOutput, message: string): void {
        this.compactToolResult(toolResult, message);
    }
}

function newToolResult(id: string, output: FunctionCallOutput['output']): FunctionCallOutput {
    return {type: 'function_call_output', call_id: id, output};
}

let compactor: TestableOpenAIResponseCompactor;

beforeEach(() => {
    compactor = new TestableOpenAIResponseCompactor();
});

describe('OpenAIResponseMessagesCompactor getToolResults', () => {

    test('keeps the function call outputs of the history in order', () => {
        const first = newToolResult('call_1', 'a');
        const second = newToolResult('call_2', 'b');
        expect(compactor.resultsOf([
            {role: 'user', content: 'hi'},
            first,
            {type: 'function_call', call_id: 'call_2', name: 'read_file', arguments: '{}'},
            second,
        ])).toEqual([first, second]);
    });

    test('ignores the messages and the function calls', () => {
        expect(compactor.resultsOf([
            {role: 'user', content: 'hi'},
            {role: 'assistant', content: 'hello'},
            {type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{}'},
        ])).toEqual([]);
    });

    test('returns nothing for an empty history', () => {
        expect(compactor.resultsOf([])).toEqual([]);
    });
});

describe('OpenAIResponseMessagesCompactor getContentLength', () => {

    test('measures a string output', () => {
        expect(compactor.lengthOf(newToolResult('call_1', 'hello'))).toBe(5);
    });

    test('sums the text of every input text block', () => {
        expect(compactor.lengthOf(newToolResult('call_1', [
            {type: 'input_text', text: 'hello'}, {type: 'input_text', text: 'ok'},
        ]))).toBe(7);
    });

    test('skips the blocks that are not input text', () => {
        expect(compactor.lengthOf(newToolResult('call_1', [
            {type: 'input_image', detail: 'auto', image_url: 'https://example.com/a.png'},
            {type: 'input_text', text: 'hello'},
        ]))).toBe(5);
    });

    test('measures an empty output as zero', () => {
        expect(compactor.lengthOf(newToolResult('call_1', ''))).toBe(0);
    });
});

describe('OpenAIResponseMessagesCompactor compactToolResult', () => {

    test('replaces a string output with the placeholder', () => {
        const result = newToolResult('call_1', 'a very long output');
        compactor.compact(result, COMPACTED);
        expect(result.output).toBe(COMPACTED);
    });

    test('replaces a block output with the placeholder', () => {
        const result = newToolResult('call_1', [{type: 'input_text', text: 'a very long output'}]);
        compactor.compact(result, COMPACTED);
        expect(result.output).toBe(COMPACTED);
    });
});

describe('OpenAIResponseMessagesCompactor compactOldResults', () => {

    test('compacts only the oldest big results of a real history', () => {
        const messages: ThinkingMessage[] = [...Array(21).keys()]
            .map(index => newToolResult(`call_${index}`, 'x'.repeat(2000)));
        compactor.compactOldResults(messages, newTestContext());
        expect((messages[0] as FunctionCallOutput).output).toBe(COMPACTED);
        expect((messages[1] as FunctionCallOutput).output).toBe('x'.repeat(2000));
    });

    test('leaves a short old result alone', () => {
        const messages: ThinkingMessage[] = [...Array(21).keys()]
            .map(index => newToolResult(`call_${index}`, 'x'.repeat(1200)));
        compactor.compactOldResults(messages, newTestContext());
        expect((messages[0] as FunctionCallOutput).output).toBe('x'.repeat(1200));
    });
});
