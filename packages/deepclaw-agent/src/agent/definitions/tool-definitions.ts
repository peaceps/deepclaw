import { LoopKind, OneLoopContext } from './definitions';
import { AgentMode } from '@deepclaw/config';
import { AgentInteractionEventPayload } from '@deepclaw/core';

export type LLMTool = {
    name: string;
    description: string;
    schema: {
        type: 'object';
        properties?: unknown | null;
        required?: Array<string> | null;
        [k: string]: unknown;
    }
}

export type ToolUseDef = {
    id: string;
    name: string;
    input: unknown;
}

export type ToolUseResult = {
    id: string;
    content: string;
}

export type ToolGuardResult = {
    result: 'allowed';
} | {
    result: 'denied';
    reason: string;
} | {
    result: 'ask';
    question: AgentInteractionEventPayload;
    checkAnswer: (answer: string) => boolean;
}

export type ToolCallback<T = unknown> = (input: T, context: OneLoopContext) => Promise<string>;

export const ALL_LOOP_KINDS: LoopKind[] = ['main', 'task', 'sub'];

export type ToolDesc<T = unknown> = {
    tool: LLMTool;
    parallelSafe: boolean;
    /** How many calls of this tool one group may hold, for a tool that costs more than a call. */
    maxParallel?: number;
    agentMode: AgentMode[];
    /** The kinds of loop this tool is handed to. Every kind of them where it is not named. */
    loopKinds?: LoopKind[];
    invoke: ToolCallback<T>;
    guard?: (input: T, context: OneLoopContext) => ToolGuardResult;
}
