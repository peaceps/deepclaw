import type { Logger } from '@deepclaw/node-utils';
import {
    SealedAgentHandler, LLMTransitionReason,
    type AgentRuntime, type TokenUsage,
    FlushAgentRole,
    FlushAgent,
} from '@deepclaw/core';
import { AgentConfig } from '@deepclaw/config';

export type LLMProtocol = 'Anthropic' | 'OpenAIChat' | 'OpenAIResponse';

export type FootPrint = {
    type: string;
    content: string;
}

/** What a drawn picture is filed under, so a loop can name the images it produced. */
export const IMAGE_FOOT_PRINT = 'image';

/**
 * The system prompt in the three pieces the cache reads it in. Both of the first two are cached,
 * with a breakpoint of their own each: what the agent learns about itself mid session sits behind
 * the part that never moves, so a memory it saves rewrites its own piece and leaves the rest read
 * from the cache. The last piece is rebuilt every turn and never worth a breakpoint.
 */
export type SystemPrompt = {
    cacheable: string;
    learned: string;
    dynamic: string;
}

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

/**
 * The task a sub loop was spawned for. Kept as a reference instead of a copy of the task, so that
 * every turn reads the state the task is in by then, steps included.
 */
export type AssignedTask = {
    projectId: string;
    taskId: string;
}

/**
 * What a loop was started as. A main loop is the one a session belongs to and the only one kept on
 * disk. A task loop works one task of the project it was handed, and hands parts of it on. A sub
 * loop is the end of the chain: it works the prompt it was given and reports back.
 */
export type LoopKind = 'main' | 'task' | 'sub';

/** Everything a spawned loop has to know before it can even tell which session is its own. */
export type SpawnedLoop = {
    kind: Exclude<LoopKind, 'main'>;
    /** The handle of this one run: the session folder it gets, and what tells its logs apart. */
    runId: string;
    /**
     * The task a task loop works on. A sub loop of it is handed the same task, not to work on it
     * but to work as the agent it belongs to, with the memory and the skills of that agent.
     */
    assignedTask?: AssignedTask;
}

/**
 * A spawned loop leaves nothing behind and talks to nobody: its session is thrown away with the
 * run, and whatever it has to say goes to the loop that spawned it rather than to a user.
 */
export function isSpawnedLoop(loopKind: LoopKind): boolean {
    return loopKind !== 'main';
}

export type OneLoopContext = {
    role: FlushAgentRole;
    agentId: string;
    /**
     * The agent a spawned loop stands in for while it works on a task assigned to that agent. Unset
     * wherever nothing is borrowed, which is every loop working on no task of anybody.
     */
    personaId?: string;
    projectId: string;
    loopId: string;
    browserId: string;
    sessionDir: string;
    loopKind: LoopKind;
    loopConfig: AgentConfig;
    system: SystemPrompt;
    logger: Logger;
    actions: {
        newTaskLoop: (assignedTask: AssignedTask) => FlushAgent;
        newSubLoop: () => FlushAgent;
        addFootPrint: (footPrint: FootPrint) => void;
        agentHandler: SealedAgentHandler;
        addStringMessage: (message: string) => void;
    },
    runtime: AgentRuntime
}

/**
 * The agent whose memory and skills a run works with: the one it stands in for where there is such
 * an agent, and the one running the loop everywhere else. Everything the loop owns on disk stays
 * with `agentId` instead, a borrowed name does not move session files or ownership around.
 */
export function personaOf(context: OneLoopContext): string {
    return context.personaId ?? context.agentId;
}

export type LoopSessionStatus = 'running' | 'paused' | 'idle' | 'error';

export type SessionMetaData = {
    llmProtocol: LLMProtocol;
    agentId: string;
    projectId: string;
    loopId: string;
    loopKind: LoopKind;
    messagesPath: string;
    runtime: {
        status: LoopSessionStatus;
        transitionReason?: LLMTransitionReason;
        turnCount: number;
        finalText?: string;
        updatedAt: string;
        endedAt?: string;
        usage: TokenUsage;
    }
}
