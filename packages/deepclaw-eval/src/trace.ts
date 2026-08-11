import type { AgentInfoEvent, Project, TokenUsage } from '@deepclaw/core';
import type { StubRequest } from './llm-stub';

export type ToolCallTrace = {
    name: string;
    input: unknown;
    ok: boolean;
    ms: number;
};

export type RunTrace = {
    scenarioId: string;
    startedAt: string;
    /** The whole child process: module loading and seeding included. Not a speed number. */
    latencyMs: number;
    /** Only loop.invoke. This is the one to watch. */
    invokeMs: number;
    /** One entry per turn, in order. */
    turnMs: number[];
    /** Set when the run itself blew up; every grader fails in that case. */
    error?: string;

    status: string;
    transitionReason?: string;
    breakReason?: string;
    turns: number;
    finalText: string;

    toolCalls: ToolCallTrace[];
    guardDenied: {name: string, reason: string}[];
    compactions: {toolResults: number, history: number};
    interrupts: string[];

    usage: TokenUsage;
    /** What the model was asked, straight from the stub; lets a grader assert on the prompt. */
    llmRequests: StubRequest[];
    scriptExhausted: boolean;

    projectFinal?: Project;
    messages: unknown[];
    infoEvents: AgentInfoEvent[];
    unexpectedInteractions: string[];
};

export const EMPTY_USAGE: TokenUsage = {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0};
