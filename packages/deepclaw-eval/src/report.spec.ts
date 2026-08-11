import { describe, expect, test } from 'vitest';
import { metricsOf } from './metrics';
import { formatReport, newReport } from './report';
import type { CaseResult } from './runner';
import { EMPTY_USAGE, type RunTrace } from './trace';

function newCase(overrides: Partial<CaseResult> = {}): CaseResult {
    const trace: RunTrace = {
        scenarioId: 'case', startedAt: '', latencyMs: 3120, invokeMs: 120, turnMs: [70, 50],
        status: 'idle', turns: 2,
        finalText: '', toolCalls: [], guardDenied: [], compactions: {toolResults: 0, history: 0},
        interrupts: [], usage: EMPTY_USAGE, llmRequests: [], scriptExhausted: false,
        messages: [], infoEvents: [], unexpectedInteractions: [],
    };
    return {
        scenarioId: 'case', description: 'a case', passed: true, grades: [], trace,
        metrics: metricsOf(trace), ...overrides,
    };
}

describe('the report', () => {

    test('counts what passed and what did not', () => {
        const report = newReport([newCase(), newCase({passed: false})]);

        expect(report).toMatchObject({total: 2, passed: 1, failed: 1});
    });

    test('names the failing cases and only their failing checks', () => {
        const report = newReport([newCase({
            scenarioId: 'writes-a-file',
            passed: false,
            grades: [
                {name: 'status is idle', passed: true},
                {name: 'notes/summary.md exists', passed: false, detail: 'file does not exist'},
            ],
        })]);

        const text = formatReport(report);
        expect(text).toContain('FAIL  writes-a-file');
        expect(text).toContain('notes/summary.md exists - file does not exist');
        expect(text).not.toContain('status is idle');
        expect(text).toContain('0/1 passed');
    });

    test('shows the cost of a case next to its result', () => {
        const text = formatReport(newReport([newCase()]));

        expect(text).toContain('2 turns, 0 tool calls, invoke 120ms (tools 0ms, overhead 120ms)');
    });

    test('keeps the loop time apart from the time the process spent starting up', () => {
        const text = formatReport(newReport([newCase()]));

        expect(text).toContain('invoke 120ms');
        expect(text).toContain('process 3120ms');
    });

    test('reports how much prompt was sent, and stays quiet when nothing was', () => {
        const quiet = newCase();
        const talkative = newCase();
        talkative.metrics.prompt = {
            calls: 3, systemChars: 6144, toolsChars: 5120, firstCallChars: 12288,
            peakCallChars: 18432, totalChars: 47104, estInputTokens: 11776,
        };

        expect(formatReport(newReport([quiet]))).not.toContain('prompt:');
        expect(formatReport(newReport([talkative]))).toContain(
            'prompt: 3 calls, base 12KB (system 6KB + tools 5KB), peak 18KB, total 46KB ~11.8k tok'
        );
    });

    test('points at the sandbox when one was kept for a post mortem', () => {
        const text = formatReport(newReport([newCase({home: '/tmp/kept'})]));

        expect(text).toContain('sandbox kept at /tmp/kept');
    });
});