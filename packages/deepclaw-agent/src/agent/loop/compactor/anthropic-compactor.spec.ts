import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {ToolResultBlockParam} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import type {ThinkingMessage} from '../../llm/anthropic-llm';
import {newTestContext} from '../../../test-support/one-loop-context';
import {AnthropicMessagesCompactor} from './anthropic-compactor';
import {MAX_RECENT_TOOL_RESULT_COUNT} from './abstract-messages-compactor';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const COMPACTED = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';

class TestableAnthropicCompactor extends AnthropicMessagesCompactor {

    public resultsOf(messages: ThinkingMessage[]): ToolResultBlockParam[] {
        return this.getToolResults(messages);
    }

    public lengthOf(toolResult: ToolResultBlockParam): number {
        return this.getContentLength(toolResult);
    }

    public compact(toolResult: ToolResultBlockParam, message: string): void {
        this.compactToolResult(toolResult, message);
    }
}

function newToolResult(id: string, content: ToolResultBlockParam['content']): ToolResultBlockParam {
    return {type: 'tool_result', tool_use_id: id, content};
}

let compactor: TestableAnthropicCompactor;

beforeEach(() => {
    compactor = new TestableAnthropicCompactor();
});

describe('AnthropicMessagesCompactor getToolResults', () => {

    test('collects the tool result blocks of every message', () => {
        const first = newToolResult('tu1', 'a');
        const second = newToolResult('tu2', 'b');
        const messages: ThinkingMessage[] = [
            {role: 'user', content: [first]},
            {role: 'user', content: [second]},
        ];
        expect(compactor.resultsOf(messages)).toEqual([first, second]);
    });

    test('ignores the text and tool use blocks around them', () => {
        const result = newToolResult('tu1', 'a');
        const messages: ThinkingMessage[] = [{role: 'user', content: [
            {type: 'text', text: 'here you go'},
            result,
            {type: 'tool_use', id: 'tu2', name: 'read_file', input: {}},
        ]}];
        expect(compactor.resultsOf(messages)).toEqual([result]);
    });

    test('skips a message whose content is a plain string', () => {
        expect(compactor.resultsOf([{role: 'user', content: 'plain text'}])).toEqual([]);
    });

    test('returns nothing for an empty history', () => {
        expect(compactor.resultsOf([])).toEqual([]);
    });

    /**
     * A history in another model's shape, which is what a session holds between the base url
     * changing and the migration that follows it. Passing over it is the whole of what is wanted
     * here: the compaction of old results is skipped for a history known to be outdated, and this
     * runs where it was not known -- so what it must not do is take the run down before the turn
     * that would have migrated the conversation has had its chance.
     */
    test('passes over a message carrying no content blocks at all', () => {
        const result = newToolResult('tu1', 'a');
        const messages = [
            {type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{}'},
            {role: 'assistant', tool_calls: [{id: 'c2', type: 'function'}]},
            {role: 'user', content: [result]},
        ] as unknown as ThinkingMessage[];
        expect(compactor.resultsOf(messages)).toEqual([result]);
    });
});

describe('AnthropicMessagesCompactor getContentLength', () => {

    test('measures a string content', () => {
        expect(compactor.lengthOf(newToolResult('tu1', 'hello'))).toBe(5);
    });

    test('sums the text of every text block', () => {
        expect(compactor.lengthOf(newToolResult('tu1', [
            {type: 'text', text: 'hello'}, {type: 'text', text: 'ok'},
        ]))).toBe(7);
    });

    test('counts a block that carries no text as nothing', () => {
        expect(compactor.lengthOf(newToolResult('tu1', [
            {type: 'image', source: {type: 'url', url: 'https://example.com/a.png'}},
            {type: 'text', text: 'hello'},
        ]))).toBe(5);
    });

    test('treats a missing content as empty', () => {
        expect(compactor.lengthOf(newToolResult('tu1', undefined))).toBe(0);
    });
});

describe('AnthropicMessagesCompactor compactToolResult', () => {

    test('replaces a string content with the placeholder', () => {
        const result = newToolResult('tu1', 'a very long output');
        compactor.compact(result, COMPACTED);
        expect(result.content).toBe(COMPACTED);
    });

    test('replaces a block content with the placeholder', () => {
        const result = newToolResult('tu1', [{type: 'text', text: 'a very long output'}]);
        compactor.compact(result, COMPACTED);
        expect(result.content).toBe(COMPACTED);
    });
});

describe('AnthropicMessagesCompactor compactOldResults', () => {

    test('compacts only the oldest big results of a real history', () => {
        const results = [...Array(MAX_RECENT_TOOL_RESULT_COUNT + 1).keys()]
            .map(index => newToolResult(`tu${index}`, 'x'.repeat(2000)));
        const messages: ThinkingMessage[] = results.map(result => ({role: 'user', content: [result]}));
        compactor.compactOldResults(messages, newTestContext());
        expect(results[0]!.content).toBe(COMPACTED);
        expect(results[1]!.content).toBe('x'.repeat(2000));
    });
});
