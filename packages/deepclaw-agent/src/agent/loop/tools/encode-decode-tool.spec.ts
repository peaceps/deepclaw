import {describe, expect, test} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {base64Tool} from './encode-decode-tool';

describe('base64Tool invoke', () => {

    test('encodes utf8 content into base64', async () => {
        const result = await base64Tool.invoke({content: 'hello world', action: 'encode'}, newTestContext());
        expect(result).toBe('aGVsbG8gd29ybGQ=');
    });

    test('decodes base64 content back into utf8', async () => {
        const result = await base64Tool.invoke({content: 'aGVsbG8gd29ybGQ=', action: 'decode'}, newTestContext());
        expect(result).toBe('hello world');
    });

    test('round trips multi byte characters', async () => {
        const context = newTestContext();
        const encoded = await base64Tool.invoke({content: '你好 🌍', action: 'encode'}, context);
        expect(await base64Tool.invoke({content: encoded, action: 'decode'}, context)).toBe('你好 🌍');
    });

    test('returns an empty string for empty content', async () => {
        expect(await base64Tool.invoke({content: '', action: 'encode'}, newTestContext())).toBe('');
    });

    test('reports content that is not base64 instead of answering with mojibake', async () => {
        await expect(base64Tool.invoke({content: '!!!not base64!!!', action: 'decode'}, newTestContext()))
            .rejects.toThrow('The content to decode is not valid base64.');
    });

    test('reports a truncated base64 string', async () => {
        await expect(base64Tool.invoke({content: 'aGVsbG8gd29ybGQ=X', action: 'decode'}, newTestContext()))
            .rejects.toThrow('The content to decode is not valid base64.');
    });

    test('decodes content that was wrapped over several lines', async () => {
        const encoded = await base64Tool.invoke({content: 'hello world', action: 'encode'}, newTestContext());
        const wrapped = `${encoded.slice(0, 8)}\n${encoded.slice(8)}`;
        expect(await base64Tool.invoke({content: wrapped, action: 'decode'}, newTestContext())).toBe('hello world');
    });

    test('decodes content that was sent without its padding', async () => {
        expect(await base64Tool.invoke({content: 'aGVsbG8', action: 'decode'}, newTestContext())).toBe('hello');
    });

    test('answers with an empty string when there is nothing to decode', async () => {
        expect(await base64Tool.invoke({content: '', action: 'decode'}, newTestContext())).toBe('');
    });
});

describe('base64Tool metadata', () => {

    test('is parallel safe and only offered in agent mode', () => {
        expect(base64Tool.parallelSafe).toBe(true);
        expect(base64Tool.agentMode).toEqual(['agent']);
        expect(base64Tool.tool.schema.required).toEqual(['content', 'action']);
    });
});
