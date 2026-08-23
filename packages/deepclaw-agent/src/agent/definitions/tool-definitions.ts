import { LoopKind, OneLoopContext } from './definitions';
import { AgentMode } from '@deepclaw/config';
import { AgentInteractionEventPayload, FlushAgentRole } from '@deepclaw/core';

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

/** The default visibility of a tool, so nothing may reach in and rewrite what that means. */
export const ALL_LOOP_KINDS: readonly LoopKind[] = ['main', 'task', 'sub'] as const;

/** The same for the role a run was started under, which is the other half of that default. */
export const ALL_AGENT_ROLES: readonly FlushAgentRole[] = ['agent', 'project', 'cron'] as const;

export const ALL_AGENT_MODES: readonly AgentMode[] = ['agent', 'chat'] as const;

/**
 * The run a set of tools is being handed to. Named rather than counted off, because a role and a
 * mode are both a string and both answer to "agent": two of them in a row swap without a word.
 */
export type ToolRun = {
    loopKind: LoopKind;
    role: FlushAgentRole;
    mode: AgentMode;
};

export function toolRunOf(context: OneLoopContext): ToolRun {
    return {loopKind: context.loopKind, role: context.role, mode: context.loopConfig.mode};
}

export type ToolDesc<T = unknown> = {
    tool: LLMTool;
    parallelSafe: boolean;
    /** How many calls of this tool one group may hold, for a tool that costs more than a call. */
    maxParallel?: number;
    agentMode: AgentMode[];
    /** The kinds of loop this tool is handed to. Every kind of them where it is not named. */
    loopKinds?: LoopKind[];
    /**
     * The roles a run has to have been started under to be handed this tool. Every role of them
     * where it is not named, which is what a tool that reads nothing of the run is.
     */
    roles?: FlushAgentRole[];
    invoke: ToolCallback<T>;
    guard?: (input: T, context: OneLoopContext) => ToolGuardResult;
}
