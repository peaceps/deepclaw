import { describe, expect, test } from 'vitest';
import type { StubRequest } from './llm-stub';
import { metricsOf, promptMetricsOf } from './metrics';
import { EMPTY_USAGE, type RunTrace } from './trace';

function newTrace(overrides: Partial<RunTrace> = {}): RunTrace {
    return {
        scenarioId: 'case', startedAt: '', latencyMs: 3000, invokeMs: 100, turnMs: [60, 40],
        status: 'idle', turns: 2, finalText: '', toolCalls: [], guardDenied: [],
        compactions: {toolResults: 0, history: 0}, interrupts: [], usage: EMPTY_USAGE,
        llmRequests: [], scriptExhausted: false, messages: [], infoEvents: [],
        unexpectedInteractions: [], ...overrides,
    };
}

function newRequest(system: string, rest: object[] = [], tools: object[] = []): StubRequest {
    return {
        model: 'stub',
        messages: [{role: 'system', content: system}, ...rest] as StubRequest['messages'],
        tools: tools as StubRequest['tools'],
    };
}

describe('run metrics', () => {

    test('adds up the tool calls, the failures and the time they took', () => {
        const metrics = metricsOf(newTrace({
            toolCalls: [
                {name: 'read_file', input: {}, ok: true, ms: 10},
                {name: 'write_file', input: {}, ok: false, ms: 5},
            ],
            usage: {cachedInputTokens: 40, noCachedInputTokens: 60, outputTokens: 20},
        }));

        expect(metrics).toMatchObject({
            toolCalls: 2, failedToolCalls: 1, toolMs: 15,
            inputTokens: 60, cachedInputTokens: 40, outputTokens: 20,
        });
    });

    test('splits the loop time into what the tools took and what we took', () => {
        const metrics = metricsOf(newTrace({
            toolCalls: [{name: 'read_file', input: {}, ok: true, ms: 30}],
        }));

        expect(metrics).toMatchObject({invokeMs: 100, toolMs: 30, overheadMs: 70});
    });

    test('keeps the process time apart from the loop time', () => {
        expect(metricsOf(newTrace())).toMatchObject({invokeMs: 100, latencyMs: 3000});
    });

    test('never reports negative overhead when the clocks disagree', () => {
        const metrics = metricsOf(newTrace({
            invokeMs: 5, toolCalls: [{name: 'read_file', input: {}, ok: true, ms: 9}],
        }));

        expect(metrics.overheadMs).toBe(0);
    });

    test('carries the per turn timings through', () => {
        expect(metricsOf(newTrace()).turnMs).toEqual([60, 40]);
    });
});

describe('prompt metrics', () => {

    test('takes the baseline from the first call, before anything piled up', () => {
        const prompt = promptMetricsOf([
            newRequest('you are a whale', [], [{name: 'read_file'}]),
            newRequest('you are a whale', [{role: 'user', content: 'a longer follow up'}]),
        ]);

        expect(prompt.calls).toBe(2);
        expect(prompt.systemChars).toBe('you are a whale'.length);
        expect(prompt.toolsChars).toBe(JSON.stringify([{name: 'read_file'}]).length);
    });

    test('follows the history growing across calls', () => {
        const prompt = promptMetricsOf([
            newRequest('sys'),
            newRequest('sys', [{role: 'user', content: 'x'.repeat(500)}]),
        ]);

        expect(prompt.peakCallChars).toBeGreaterThan(500);
        expect(prompt.firstCallChars).toBeLessThan(prompt.peakCallChars);
        expect(prompt.totalChars).toBe(prompt.firstCallChars + prompt.peakCallChars);
    });

    test('estimates input tokens at four characters each', () => {
        const prompt = promptMetricsOf([newRequest('x'.repeat(400))]);

        expect(prompt.estInputTokens).toBe(Math.round(prompt.totalChars / 4));
    });

    test('counts a multimodal message rather than skipping it', () => {
        const withImage = promptMetricsOf([newRequest('sys', [
            {role: 'user', content: [{type: 'image_url', image_url: {url: 'data:image/png;base64,AAAA'}}]},
        ])]);

        expect(withImage.totalChars).toBeGreaterThan(promptMetricsOf([newRequest('sys')]).totalChars);
    });

    test('reports zeroes when the model was never called', () => {
        expect(promptMetricsOf([])).toMatchObject({
            calls: 0, systemChars: 0, toolsChars: 0, firstCallChars: 0,
            peakCallChars: 0, totalChars: 0, estInputTokens: 0,
        });
    });
});
