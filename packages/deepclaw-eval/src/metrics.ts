import type { StubRequest } from './llm-stub';
import type { RunTrace } from './trace';

/**
 * What we send to the model, measured in characters. Unlike the token counts, which come from
 * the model and are therefore meaningless while a stub is answering, this is produced entirely
 * by our own code: the system prompt, the tool schemas and the history we keep resending. It
 * is deterministic, so it can be watched in CI.
 */
export type PromptMetrics = {
    calls: number;
    /** The first call is the baseline: nothing has accumulated yet. */
    systemChars: number;
    toolsChars: number;
    firstCallChars: number;
    peakCallChars: number;
    /** Everything ever sent, which is the shape the input bill follows. */
    totalChars: number;
    /** Rough, at four characters per token. Meant for orders of magnitude, not for invoices. */
    estInputTokens: number;
};

export type RunMetrics = {
    turns: number;
    toolCalls: number;
    failedToolCalls: number;
    /** loop.invoke only. */
    invokeMs: number;
    toolMs: number;
    /** Time inside the loop that no tool spent: prompt building, compaction, persistence. */
    overheadMs: number;
    turnMs: number[];
    /** The whole child process, module loading included. Context, not a speed number. */
    latencyMs: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    prompt: PromptMetrics;
};

const CHARS_PER_TOKEN = 4;

export function metricsOf(trace: RunTrace): RunMetrics {
    const toolMs = trace.toolCalls.reduce((total, call) => total + call.ms, 0);
    return {
        turns: trace.turns,
        toolCalls: trace.toolCalls.length,
        failedToolCalls: trace.toolCalls.filter(call => !call.ok).length,
        invokeMs: trace.invokeMs,
        toolMs,
        overheadMs: Math.max(trace.invokeMs - toolMs, 0),
        turnMs: trace.turnMs,
        latencyMs: trace.latencyMs,
        inputTokens: trace.usage.noCachedInputTokens,
        cachedInputTokens: trace.usage.cachedInputTokens,
        outputTokens: trace.usage.outputTokens,
        prompt: promptMetricsOf(trace.llmRequests),
    };
}

export function promptMetricsOf(requests: StubRequest[]): PromptMetrics {
    const sizes = requests.map(callChars);
    const totalChars = sizes.reduce((total, size) => total + size, 0);
    const first = requests[0];
    return {
        calls: requests.length,
        systemChars: first ? systemChars(first) : 0,
        toolsChars: first ? JSON.stringify(first.tools || []).length : 0,
        firstCallChars: sizes[0] || 0,
        peakCallChars: sizes.length ? Math.max(...sizes) : 0,
        totalChars,
        estInputTokens: Math.round(totalChars / CHARS_PER_TOKEN),
    };
}

function callChars(request: StubRequest): number {
    return JSON.stringify(request.messages || []).length
        + JSON.stringify(request.tools || []).length;
}

function systemChars(request: StubRequest): number {
    const system = (request.messages || []).find(message => message.role === 'system');
    if (!system) {
        return 0;
    }
    return typeof system.content === 'string'
        ? system.content.length
        : JSON.stringify(system.content ?? '').length;
}
