import type { FlushAgentRole, ImageContent, Project } from '@deepclaw/core';
import type { RunTrace } from './trace';

/** What the stubbed model answers when it is asked for the n-th time. */
export type ScriptedTurn = {
    text?: string;
    toolCalls?: {name: string, input: unknown}[];
};

export type ScenarioSeed = {
    agentId?: string;
    agentName?: string;
    /** 'chat' takes the computer away from the agent, which is a safety case of its own. */
    mode?: 'agent' | 'chat';
    lang?: 'en' | 'zh';
    /** Workspace files the agent can read, relative to the sandbox root. */
    files?: Record<string, string>;
    projects?: Project[];
};

export type ScenarioDriver = {
    role?: FlushAgentRole;
    projectId?: string;
    prompt: string;
    images?: ImageContent[];
};

export type Grade = {
    name: string;
    passed: boolean;
    detail?: string;
};

/** Everything a grader may look at besides the trace: the sandbox as the run left it. */
export type GradeContext = {
    home: string;
    readFile(relativePath: string): string | null;
    exists(relativePath: string): boolean;
};

export type Grader = (trace: RunTrace, context: GradeContext) => Grade | Grade[];

export type EvalScenario = {
    id: string;
    description: string;
    seed?: ScenarioSeed;
    /** One entry per model call. A run that asks for more is a scenario bug and is reported. */
    script: ScriptedTurn[];
    driver: ScenarioDriver;
    /** Answers for the questions the agent may ask, matched on a substring of the question. */
    interaction?: Record<string, string>;
    limits?: {
        maxTurns?: number;
        timeoutMs?: number;
    };
    graders: Grader[];
};

export const DEFAULT_AGENT_ID = 'eval-agent';
export const DEFAULT_TIMEOUT_MS = 60_000;
