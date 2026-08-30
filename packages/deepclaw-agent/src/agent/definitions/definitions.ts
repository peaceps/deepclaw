import type { Logger } from '@deepclaw/node-utils';
import {
    SealedAgentHandler, LLMTransitionReason,
    type AgentRuntime, type TokenUsage,
    FlushAgentRole,
    FlushAgent,
} from '@deepclaw/core';
import { AgentConfig, type LLMProtocol } from '@deepclaw/config';

/**
 * Passed on from where it is written down, so that the list a user picks from and the loops built
 * to it are one list: a protocol offered in the settings with no loop of its own would not compile.
 */
export type { LLMProtocol };

/**
 * A limit the far end named while refusing a request, in whichever unit it named it in.
 *
 * The two are kept apart because they are different things. Tokens are the window of the model.
 * Bytes are a cap on the size of a request, belonging to whatever gateway stands in front of it,
 * and a body limit of six million read as a window would be a window nothing could ever fill.
 * Either may be absent: most refusals name one and no refusal has to name any.
 */
export type OverflowLimit = {
    tokens?: number;
    bytes?: number;
};

export type FootPrint = {
    type: string;
    content: string;
    /**
     * Set on a step the run did not take itself but was handed by one of its own subagents. The
     * account a run gives of the work has the whole tree in it, and whose hands did what is half
     * of reading such a list: the marked steps also say why the list runs as it does, a branch
     * landing all at once when it came back rather than a step at a time as the run worked.
     */
    viaSubagent?: boolean;
}

/** What a drawn picture is filed under, so a loop can name the images it produced. */
export const IMAGE_FOOT_PRINT = 'image';

/**
 * What a file the agent read is filed under, so a summary can list what the run has already seen.
 *
 * Named here rather than at either end that uses it, which is the whole of what this constant is
 * for: a footprint is written in a tool and read in the compactor, two files with no reason to
 * import each other, and the only thing that made the trace work was the two spelling the same
 * word. They did not. The compactor asked for this name while every writer used another, so the
 * action trace of every summary went out empty and nothing anywhere could say so.
 */
export const READ_FILE_FOOT_PRINT = 'read_file';

/**
 * What the run changed rather than what it looked at, filed the same way and read somewhere else
 * again: a spawned loop that ends without an answer hands these up to the loop that spawned it,
 * and its session is deleted the moment the call returns, so this is what is left of the work.
 *
 * A command in the background is filed apart from one in the foreground, which is the one place
 * the difference is worth a word: it outlives the loop that started it, the signal it was given
 * belonging to the run above. A foreground command in the trace is something that happened; a
 * background one may still be happening, in files nobody upstairs knows are being written.
 *
 * It is also the one line of such a trace that leads anywhere. Everything else of a spawned loop
 * goes with its session, while a background command is filed under the loop id it was started
 * with -- which a spawned loop shares with the loop above it -- so the run that reads this can
 * still list it, look in on it and clear it away.
 */
export const WRITE_FILE_FOOT_PRINT = 'write_file';
export const EDIT_FILE_FOOT_PRINT = 'edit_file';
export const RUN_COMMAND_FOOT_PRINT = 'run_command';
export const BACKGROUND_COMMAND_FOOT_PRINT = 'run_background_command';

/**
 * The footprints of a run's doing, which are the ones a spawned loop reports when it ends with the
 * work unaccounted for. Named as a set because the account is cut to the last of it and the reads
 * would crowd the changes out of that window: a run reads all day and writes a handful of times,
 * so twenty steps of everything is twenty files it looked at and no word of what it did.
 *
 * A footprint added above belongs in here if it changed something outside the run.
 */
export const CHANGE_FOOT_PRINTS: readonly string[] = [
    WRITE_FILE_FOOT_PRINT, EDIT_FILE_FOOT_PRINT, RUN_COMMAND_FOOT_PRINT, BACKGROUND_COMMAND_FOOT_PRINT,
];

/**
 * The footprints worth handing to a loop built in place of one that was evicted, which is the two
 * kinds something on the other side reads: the files read are listed in every summary from then
 * on, and the pictures are named by whoever spawned the loop.
 *
 * The changes are not among them and would be dead weight if they were. What reads them is the
 * account a spawned loop gives of itself, and a spawned loop is torn down whole rather than
 * evicted, so nothing that survives an eviction ever asks for one. Carried anyway they would grow
 * with how long a conversation has been talked in: a command line is different every time, so the
 * one thing that holds the carried list down -- each of them once -- does nothing for them.
 */
export const CARRIED_FOOT_PRINTS: readonly string[] = [READ_FILE_FOOT_PRINT, IMAGE_FOOT_PRINT];

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
    /**
     * Everything the model has said out loud over this run, which is what the user has been
     * reading: the words of one turn are answered by the words of the next, but the screen keeps
     * them all, and a run that ends with nothing of its own to say has these to show for itself.
     */
    said: string;
}

/** What a permission is asked for as a whole, rather than one command or one path at a time. */
export type PermissionGroup = 'command' | 'file';

/**
 * What the user waved through for the rest of the conversation. It belongs to the loop rather than
 * to the turn, so an answer given once is not asked for again with the next message, and every loop
 * a run spawns works with the very same set: a grant given deep inside a run is a grant the
 * conversation has, and a copy handed down instead would leave each loop asking for itself.
 *
 * It lives as long as the loop holding it, and where that is a shorter life than the conversation
 * it is meant to be: the gateway builds the loop anew where the session no longer matches the
 * protocol it was written in, so pointing the agent at another provider asks for the permissions
 * again. A loop dropped to free memory hands the set on instead (`CarriedLoopState`) -- there is
 * nothing about that rebuild for a user to be asked about. Nothing granted here is written down
 * anywhere, so a restart is a fresh set either way.
 */
export type PermissionWhiteList = Set<PermissionGroup>;

/**
 * What a loop hands to the one built in its place when the gateway lets it go to reclaim the memory
 * it was holding. Everything else about it survives on its own: the same agent, the same session on
 * disk, the same provider. These are the parts of a conversation that were never written anywhere,
 * so they cross over here or they are gone.
 *
 * Given as an argument rather than looked up, and that is the whole of why the type exists. The
 * rebuild after an eviction and the rebuild after a provider change go through the very same
 * constructor, and the second one is meant to start over -- so anything the constructor could fetch
 * for itself would be inherited by both.
 */
export type CarriedLoopState = {
    permissionWhiteList: PermissionWhiteList;
    /** Absent where the loop it came from never had a request of its own answered. */
    lastInputTokens?: number;
    footPrints: FootPrint[];
};

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
 * loop is the end of the chain: it works the prompt it was given and reports back. A review loop
 * reads a task somebody else worked and gives a verdict on it, and is the one kind that is there
 * to change nothing: what it hands back is what it thinks of the work.
 */
export type LoopKind = 'main' | 'task' | 'sub' | 'review';

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
    /**
     * The agent whose config this run works with: its model, its mode, its keys, and nothing else
     * of it. Who the run speaks as is still the loop that spawned it -- every event of this one is
     * stamped with that loop's id, and it works under the permissions answered for that loop. A
     * task handed to somebody else is worked on by their model, it is not authorised anew by them.
     *
     * Unset wherever a run works with the config of the loop that spawned it, which is every task
     * nobody owns and every task owned by the agent handing it over.
     */
    runAs?: string;
    /** The list of the loop that spawned it, which it works with instead of asking for itself. */
    permissionWhiteList: PermissionWhiteList;
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
    /**
     * The one task a spawned loop was pointed at: the task a task loop works, and the task a review
     * reads. What a tool of such a run may write it on, so that naming a task is never a thing a
     * model does -- a review handed a task id of its own could file its report on another task.
     */
    assignedTask?: AssignedTask;
    projectId: string;
    loopId: string;
    browserId: string;
    sessionDir: string;
    loopKind: LoopKind;
    loopConfig: AgentConfig;
    system: SystemPrompt;
    logger: Logger;
    actions: {
        newTaskLoop: (assignedTask: AssignedTask) => Promise<FlushAgent>;
        newReviewLoop: (assignedTask: AssignedTask) => Promise<FlushAgent>;
        newSubLoop: () => FlushAgent;
        addFootPrint: (footPrint: FootPrint) => void;
        agentHandler: SealedAgentHandler;
        addStringMessage: (message: string) => void;
    },
    permissionWhiteList: PermissionWhiteList;
    /** What every await of this run watches, so a stop reaches the one it is sitting in. */
    abortSignal?: AbortSignal;
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

/**
 * Whose card this run speaks from, and nothing where it speaks from none.
 *
 * A main loop is its own agent. A run working on a task speaks from the agent that task belongs to:
 * it thinks with their model, works with their memory and their skills, and answers to their name
 * in its prompt, so the whole of what it could tell about itself is theirs. That is the run somebody
 * hands a task to and watches the card of, and a card that stands still through an afternoon of work
 * done in that name is a card saying the wrong thing.
 *
 * Nobody in the four cases where the run is nobody. A scheduled run feels nothing on anyone's
 * behalf: nobody asked it for anything and nobody watched it go, and what it left on a card would
 * stand there as the mood of an agent until somebody next opened a chat with them. A sub loop is a
 * piece of a task rather than a task: several of them run under one borrowed name at once, and one
 * card written by all of them is a flicker instead of a feeling. A review reads work over and hands
 * back a judgement; it is offered no feeling in its prompt and has no tool to leave one with, and a
 * card aged by turns nobody was shown is a card going stale in silence. A run working a task nobody
 * owns has no name at all -- its prompt gives it none -- and a mood from it would be a run the user
 * never saw speaking as the loop that spawned it.
 *
 * The tool names the scheduled run again before asking this, and that is worth keeping: it answers
 * a model with what is true of a cron run rather than with the general shape of the refusal, and
 * the general shape is the vaguer of the two by exactly the reason.
 *
 * The prompt asks the same question in its own terms, in the `feels` of provideSystemPrompt: what a
 * run may say has to be what it was told it may say, or it is either asked for a feeling that will
 * be refused or refused one it was invited to give.
 */
export function feelerOf(context: OneLoopContext): string | undefined {
    if (context.role === 'cron' || context.loopKind === 'sub' || context.loopKind === 'review') {
        return undefined;
    }
    return isSpawnedLoop(context.loopKind) ? context.personaId : context.agentId;
}

/**
 * Whether this run was stopped. The signal is what says so, rather than the exception that came
 * out of whichever await was cut short: every layer below throws a shape of its own for an abort,
 * an SDK is free to change which, and a run reads the same answer from the signal everywhere.
 */
export function isRunStopped(context: OneLoopContext): boolean {
    return context.abortSignal?.aborted === true;
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
        /**
         * What the conversation is called, taken from the first thing asked of it and never taken
         * again: a name that followed the latest question would rename what is already filed away
         * under it. Absent in one begun without a word, and in one that ran before names.
         */
        name?: string;
        /** Absent in a session that was already on disk before conversations could be closed. */
        startedAt?: string;
        updatedAt: string;
        endedAt?: string;
        usage: TokenUsage;
    }
}

/**
 * A conversation that was closed, as a chat lists it to be read back. The id is the folder it was
 * moved to, which is also the order they are listed in.
 */
export type SessionSummary = {
    sessionId: string;
    /** Absent in a conversation closed before they had names, which is read back by its time. */
    name?: string;
    startedAt?: string;
    updatedAt: string;
    turnCount: number;
    finalText: string;
    usage: TokenUsage;
}
