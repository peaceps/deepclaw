import {describe, expect, test, vi} from 'vitest';
import type {LLMProtocol} from '../../definitions/definitions';
import {AnthropicMessagesCompactor} from './anthropic-compactor';
import {OpenAIChatMessagesCompactor} from './openai-chat-compactor';
import {OpenAIResponseMessagesCompactor} from './openai-response-compactor';
import {MessageCompactor} from './messages-compactor';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

describe('MessageCompactor getCompactor', () => {

    test('serves the anthropic compactor for the anthropic protocol', () => {
        expect(MessageCompactor.getCompactor('Anthropic')).toBeInstanceOf(AnthropicMessagesCompactor);
    });

    test('serves the chat compactor for the openai chat protocol', () => {
        expect(MessageCompactor.getCompactor('OpenAIChat')).toBeInstanceOf(OpenAIChatMessagesCompactor);
    });

    test('serves the response compactor for the openai response protocol', () => {
        expect(MessageCompactor.getCompactor('OpenAIResponse')).toBeInstanceOf(OpenAIResponseMessagesCompactor);
    });

    test('pools one compactor per protocol', () => {
        expect(MessageCompactor.getCompactor('Anthropic')).toBe(MessageCompactor.getCompactor('Anthropic'));
    });

    test('keeps the compactors of the different protocols apart', () => {
        expect(MessageCompactor.getCompactor('OpenAIChat')).not.toBe(MessageCompactor.getCompactor('OpenAIResponse'));
    });

    test('rejects a protocol it does not know', () => {
        expect(() => MessageCompactor.getCompactor('Gemini' as LLMProtocol))
            .toThrow('Unknown loop type: Gemini');
    });
});
