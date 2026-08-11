import { afterEach, describe, expect, test } from 'vitest';
import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionTool } from 'openai/resources/chat/completions';
import { startLLMStub, type LLMStub } from './llm-stub';

let stub: LLMStub | undefined;

afterEach(async () => {
    await stub?.close();
    stub = undefined;
});

async function ask(prompt: string, tools: ChatCompletionTool[] = []): Promise<ChatCompletionChunk[]> {
    const client = new OpenAI({baseURL: stub!.url, apiKey: 'eval'});
    const stream = await client.chat.completions.create({
        model: 'eval-stub',
        messages: [{role: 'user', content: prompt}],
        tools,
        stream: true,
        stream_options: {include_usage: true},
    });
    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return chunks;
}

function textOf(chunks: ChatCompletionChunk[]): string {
    return chunks.map(chunk => chunk.choices[0]?.delta?.content || '').join('');
}

describe('the llm stub', () => {

    test('streams the scripted text and closes the turn with stop', async () => {
        stub = await startLLMStub([{text: 'hello there'}]);

        const chunks = await ask('hi');

        expect(textOf(chunks)).toContain('hello there');
        expect(chunks.some(chunk => chunk.choices[0]?.finish_reason === 'stop')).toBe(true);
    });

    test('reports token usage on the last chunk', async () => {
        stub = await startLLMStub([{text: 'hi'}]);

        const chunks = await ask('hi');

        const usage = chunks.find(chunk => chunk.usage)?.usage;
        expect(usage!.prompt_tokens).toBe(100);
        expect(usage!.prompt_tokens_details!.cached_tokens).toBe(40);
    });

    test('emits a tool call and finishes with tool_calls', async () => {
        stub = await startLLMStub([{toolCalls: [{name: 'read_file', input: {filePath: 'a.md'}}]}]);

        const chunks = await ask('read it');

        const toolCall = chunks.flatMap(chunk => chunk.choices[0]?.delta?.tool_calls || [])[0];
        expect(toolCall!.function!.name).toBe('read_file');
        expect(JSON.parse(toolCall!.function!.arguments!)).toEqual({filePath: 'a.md'});
        expect(chunks.some(chunk => chunk.choices[0]?.finish_reason === 'tool_calls')).toBe(true);
    });

    test('never issues the same tool call id twice in a run', async () => {
        stub = await startLLMStub([
            {toolCalls: [{name: 'read_file', input: {}}]},
            {toolCalls: [{name: 'write_file', input: {}}, {name: 'read_file', input: {}}]},
        ]);

        const ids = [...await ask('a'), ...await ask('b')]
            .flatMap(chunk => chunk.choices[0]?.delta?.tool_calls || [])
            .map(toolCall => toolCall.id);

        expect(ids).toEqual(['call_1', 'call_2', 'call_3']);
    });

    test('answers each call with the next turn of the script', async () => {
        stub = await startLLMStub([{text: 'first'}, {text: 'second'}]);

        const first = await ask('a');
        const second = await ask('b');

        expect(textOf(first)).toContain('first');
        expect(textOf(second)).toContain('second');
    });

    test('records what the model was asked, tools included', async () => {
        stub = await startLLMStub([{text: 'ok'}]);

        await ask('what is up', [{type: 'function', function: {name: 'write_file', parameters: {}}}]);

        expect(stub.requests).toHaveLength(1);
        expect(stub.requests[0]!.messages[0]).toMatchObject({role: 'user', content: 'what is up'});
        expect(stub.requests[0]!.tools[0]!.function!.name).toBe('write_file');
    });

    test('keeps answering after the script runs dry, and says so', async () => {
        stub = await startLLMStub([{text: 'only one'}]);

        await ask('a');
        expect(stub.exhausted).toBe(false);

        const extra = await ask('b');
        expect(stub.exhausted).toBe(true);
        expect(textOf(extra)).toContain('ran out of answers');
    });
});
