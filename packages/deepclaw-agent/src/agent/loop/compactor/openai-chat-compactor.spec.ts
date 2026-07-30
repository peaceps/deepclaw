import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {ChatCompletionToolMessageParam} from 'openai/resources/chat/completions.js';
import type {ThinkingMessage} from '../../llm/openai-chat-llm';
import {newTestContext} from '../../../test-support/one-loop-context';
import {OpenAIChatMessagesCompactor} from './openai-chat-compactor';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const COMPACTED = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';

class TestableOpenAIChatCompactor extends OpenAIChatMessagesCompactor {

    public resultsOf(messages: ThinkingMessage[]): ChatCompletionToolMessageParam[] {
        return this.getToolResults(messages);
    }

    public lengthOf(toolResult: ChatCompletionToolMessageParam): number {
        return this.getContentLength(toolResult);
    }

    public compact(toolResult: ChatCompletionToolMessageParam, message: string): void {
        this.compactToolResult(toolResult, message);
    }
}

function newToolResult(
    id: string, content: ChatCompletionToolMessageParam['content']
): ChatCompletionToolMessageParam {
    return {role: 'tool', tool_call_id: id, content};
}

let compactor: TestableOpenAIChatCompactor;

beforeEach(() => {
    compactor = new TestableOpenAIChatCompactor();
});

describe('OpenAIChatMessagesCompactor getToolResults', () => {

    test('keeps the tool messages of the history in order', () => {
        const first = newToolResult('call_1', 'a');
        const second = newToolResult('call_2', 'b');
        expect(compactor.resultsOf([
            {role: 'user', content: 'hi'},
            first,
            {role: 'assistant', content: 'thinking'},
            second,
        ])).toEqual([first, second]);
    });

    test('ignores the system, user and assistant messages', () => {
        expect(compactor.resultsOf([
            {role: 'system', content: 'be nice'},
            {role: 'user', content: 'hi'},
            {role: 'assistant', content: 'hello'},
        ])).toEqual([]);
    });

    test('returns nothing for an empty history', () => {
        expect(compactor.resultsOf([])).toEqual([]);
    });
});

describe('OpenAIChatMessagesCompactor getContentLength', () => {

    test('measures a string content', () => {
        expect(compactor.lengthOf(newToolResult('call_1', 'hello'))).toBe(5);
    });

    test('sums the text of every content part', () => {
        expect(compactor.lengthOf(newToolResult('call_1', [
            {type: 'text', text: 'hello'}, {type: 'text', text: 'ok'},
        ]))).toBe(7);
    });

    test('counts an empty content part as nothing', () => {
        expect(compactor.lengthOf(newToolResult('call_1', [
            {type: 'text', text: ''}, {type: 'text', text: 'hello'},
        ]))).toBe(5);
    });

    test('measures an empty content as zero', () => {
        expect(compactor.lengthOf(newToolResult('call_1', ''))).toBe(0);
    });
});

describe('OpenAIChatMessagesCompactor compactToolResult', () => {

    test('replaces a string content with the placeholder', () => {
        const result = newToolResult('call_1', 'a very long output');
        compactor.compact(result, COMPACTED);
        expect(result.content).toBe(COMPACTED);
    });

    test('replaces a part content with the placeholder', () => {
        const result = newToolResult('call_1', [{type: 'text', text: 'a very long output'}]);
        compactor.compact(result, COMPACTED);
        expect(result.content).toBe(COMPACTED);
    });
});

describe('OpenAIChatMessagesCompactor compactOldResults', () => {

    test('compacts only the oldest big results of a real history', () => {
        const messages: ThinkingMessage[] = [...Array(21).keys()]
            .map(index => newToolResult(`call_${index}`, 'x'.repeat(2000)));
        compactor.compactOldResults(messages, newTestContext());
        expect(messages[0]!.content).toBe(COMPACTED);
        expect(messages[1]!.content).toBe('x'.repeat(2000));
    });

    test('leaves a short old result alone', () => {
        const messages: ThinkingMessage[] = [...Array(21).keys()]
            .map(index => newToolResult(`call_${index}`, 'x'.repeat(1200)));
        compactor.compactOldResults(messages, newTestContext());
        expect(messages[0]!.content).toBe('x'.repeat(1200));
    });
});
