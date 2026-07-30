import {describe, expect, test} from 'vitest';
import {addTokenUsage, newMessage, type TokenUsage} from './agent-definitions';

describe('addTokenUsage', () => {

    test('accumulates every counter into the target', () => {
        const usage: TokenUsage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        addTokenUsage(usage, {cachedInputTokens: 10, noCachedInputTokens: 20, outputTokens: 30});
        expect(usage).toEqual({cachedInputTokens: 11, noCachedInputTokens: 22, outputTokens: 33});
    });

    test('mutates the target instead of returning a new object', () => {
        const usage: TokenUsage = {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0};
        const added: TokenUsage = {cachedInputTokens: 5, noCachedInputTokens: 5, outputTokens: 5};
        addTokenUsage(usage, added);
        expect(usage.outputTokens).toBe(5);
        expect(added.outputTokens).toBe(5);
    });

    test('stays additive across repeated calls', () => {
        const usage: TokenUsage = {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0};
        const added: TokenUsage = {cachedInputTokens: 1, noCachedInputTokens: 1, outputTokens: 1};
        addTokenUsage(usage, added);
        addTokenUsage(usage, added);
        expect(usage).toEqual({cachedInputTokens: 2, noCachedInputTokens: 2, outputTokens: 2});
    });
});

describe('newMessage', () => {

    test('carries over type, agentId and content', () => {
        const message = newMessage('user', 'a1', 'hello');
        expect(message.type).toBe('user');
        expect(message.agentId).toBe('a1');
        expect(message.content).toBe('hello');
    });

    test('generates a uuid as id', () => {
        const message = newMessage('agent', 'a1', 'hi');
        expect(message.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('generates a distinct id per message', () => {
        expect(newMessage('user', 'a1', 'x').id).not.toBe(newMessage('user', 'a1', 'x').id);
    });

    test('stamps an ISO timestamp', () => {
        const message = newMessage('agent', 'a1', 'hi');
        expect(message.timestamp).toBe(new Date(message.timestamp).toISOString());
    });
});
