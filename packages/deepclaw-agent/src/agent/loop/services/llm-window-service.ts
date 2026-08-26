import { FileUtils } from '@deepclaw/node-utils';
import { AGENTS_DIR, AGENT_LLM_WINDOW_JSON } from '../../paths';
import type { OverflowLimit } from '../../definitions/definitions';

/**
 * What to assume a window holds before anything has been learned about it, in tokens.
 *
 * It does not trigger a compaction, and reading it as the threshold it looks like will mislead. The
 * gate weighs the last call against `max(this, lowerTokens * GROWTH_ALLOWANCE)`, and the floor is
 * raised to the size of that same call the moment it goes through, so both sides of that maximum
 * are above the figure being weighed and the gate cannot fire. Which is the intent -- a window
 * nobody will name is found by growing into it -- and it means the two things this number really
 * does are the two to size it by:
 *
 * It is the floor of the climb, so that an early exchange of a few hundred tokens does not pin the
 * budget at a few hundred more and leave the summarizer trimming a whole conversation down to that.
 * And it is the budget a summarizer call is trimmed against while no ceiling is known, which is the
 * one place it decides anything a user would notice.
 *
 * Tokens rather than characters or bytes: the number itself has guarded this for a long time, and
 * against chinese -- a character to a token -- it behaves as it always did. What it stops doing is
 * meaning something different per language. Read as characters it was four times too loose for
 * latin text; read as bytes, which is what it briefly was, three times too tight for chinese.
 * Exactly where the model has reported a count, estimated where it has not: one unit, two
 * precisions.
 */
export const UNLEARNED_TOKEN_BUDGET = 150000;

/**
 * How many bytes of one request to allow where no gateway has named a limit of its own.
 *
 * A backstop and not a threshold. It sits far above any window measured in tokens -- four mebibytes
 * of chinese is over a million of them -- so for any real model the token side speaks first, and
 * what is left for this to catch is the case the token side cannot see: the first turn of a run,
 * before an answer of that run has been counted, on a history that grew under some other
 * configuration.
 */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/**
 * How much larger than the largest request known to have gone through the next one may be.
 *
 * This is what lets a window be found without ever being told. A refusal names the window exactly,
 * but only a conversation that reaches the wall is ever refused, and the budget is what stops a
 * conversation from reaching it -- so a budget that never moved would hold a run at the starting
 * guess for good, whether the real window were that or twenty times it. Every call that goes
 * through proves the window is at least as wide as what it carried, so allowing a fifth more than
 * that is a bet on the window being at least a quarter wider than anything seen so far, renewed on
 * every turn and settled the moment a refusal names the real figure.
 *
 * Anything at or below one would settle nothing: the proven floor rises to whatever the last call
 * carried, so a budget of exactly the floor is a budget the conversation has already reached, and
 * the climb would stop where it started.
 */
export const GROWTH_ALLOWANCE = 1.2;

/**
 * How much of a limit a conversation is allowed to fill before it is summarized.
 *
 * The room left over is for the turn that has not happened yet: what is measured is the request
 * that was already sent, and the next one carries whatever this turn adds to it. No margin covers
 * the worst of that -- five tool results at their cap can be most of a small window by themselves
 * -- and a smaller one would not: it would only compact sooner in the ordinary case, which is
 * every case but that one. The tail is left to the refusal, which compacts and goes on.
 */
export const WINDOW_MARGIN = 0.8;

/**
 * What an agent has found out about the limits it talks through.
 *
 * Two bounds rather than one number, because both directions are evidence and neither alone is
 * enough. A refusal proves the window is no wider than what it named. A call that went through
 * proves it is at least as wide as what that call carried, and this is the half that is easy to
 * leave out: without it a window stored too low -- the far end raised it, or the name now points
 * somewhere else -- would compact early forever with nothing able to say otherwise.
 */
export type LLMWindow = {
    /** The model these were learned from. Anything else and they are not about this endpoint. */
    model: string;
    /**
     * Proven reachable: a request this big was answered. Never a budget on its own -- see
     * `GROWTH_ALLOWANCE` -- and it also retires a ceiling the far end has since gone past.
     */
    lowerTokens?: number;
    /** Proven too much: a request was refused for being over this. */
    upperTokens?: number;
    /** The gateway's limit on the bytes of a request, which is not the model's window. */
    bodyBytes?: number;
};

/**
 * What the two sides of a compaction check measure themselves against, margin already taken off.
 *
 * Both always answer. The token one is the real gate and is compared against what the model
 * reported, or against an estimate where nothing has been reported yet. The byte one is a backstop
 * against a request too large to send whatever its token count.
 */
export type WindowBudget = {
    tokens: number;
    bytes: number;
};

export class LLMWindowService {

    private static windows: Map<string, LLMWindow> = new Map();

    /**
     * Reads what was learned before, once per agent for as long as the process lives.
     *
     * The memory is shared by every loop of one agent, which is what it should be: they talk to
     * the same endpoint, and what one of them is refused over is true for the rest. So the file is
     * read on the first loop to ask and not again -- later loops start from what is already in
     * hand -- while writes go to the file every time, since a process that goes down should not
     * take the lesson with it.
     *
     * A record naming another model is thrown away whole instead of being carried over. The bounds
     * would correct themselves eventually -- that is what having two of them is for -- but an
     * upper bound from a window ten times wider costs a refused call every turn until it does, and
     * a config that has been edited is not a thing to learn the hard way.
     */
    public static load(agentId: string, model: string): LLMWindow {
        const stored = this.read(agentId);
        const window = stored?.model === model ? stored : {model};
        this.windows.set(agentId, window);
        return window;
    }

    public static windowOf(agentId: string, model: string): LLMWindow {
        const cached = this.windows.get(agentId);
        return cached?.model === model ? cached : this.load(agentId, model);
    }

    /**
     * What the two checks measure against, in the unit each of them counts in.
     *
     * A ceiling that has been named is used as named, less the margin. Absent one, the floor is
     * what there is to go on, and it is used as a floor and not as a budget: set to the size of the
     * last call that went through, it is a figure the conversation has already reached, so a budget
     * of exactly the floor is one that would compact every turn and never move. Allowing a fifth
     * more turns that into a climb -- each turn proves a little more of the window and is allowed a
     * little more than it proved -- which is how a window nobody will tell us gets found.
     *
     * The margin comes off a limit that was measured and not off a guess. A learned wall is where
     * the far end refuses, and the serialized messages are only part of what counts against it, the
     * system prompt and the tools riding along, so compacting at the wall itself is compacting one
     * turn too late. The starting guess is nobody's wall and needs no margin taken off it twice.
     */
    public static budgetOf(agentId: string, model: string): WindowBudget {
        const window = this.windowOf(agentId, model);
        return {
            tokens: window.upperTokens === undefined
                ? Math.max(
                    UNLEARNED_TOKEN_BUDGET,
                    Math.floor((window.lowerTokens ?? 0) * GROWTH_ALLOWANCE)
                )
                : Math.floor(window.upperTokens * WINDOW_MARGIN),
            bytes: window.bodyBytes === undefined
                ? MAX_REQUEST_BYTES
                : Math.floor(window.bodyBytes * WINDOW_MARGIN),
        };
    }

    /** A call that went through: the window is at least as wide as what it carried. */
    public static observeAccepted(agentId: string, model: string, inputTokens: number): void {
        if (!(inputTokens > 0)) {
            return;
        }
        const window = this.windowOf(agentId, model);
        // Before the floor, and on its own terms. An upper bound the far end has just gone past
        // was true of some other endpoint or some earlier day, and the call that just succeeded
        // outranks it. Asking this first means it holds however the floor happens to stand: were
        // it asked after, a call smaller than the floor would leave early and carry a ceiling it
        // had just disproved, and nothing but the invariant kept elsewhere would make that safe.
        const staleCeiling = window.upperTokens !== undefined && window.upperTokens <= inputTokens;
        if (staleCeiling) {
            delete window.upperTokens;
        }
        if (window.lowerTokens !== undefined && window.lowerTokens >= inputTokens) {
            if (staleCeiling) {
                this.write(agentId, window);
            }
            return;
        }
        window.lowerTokens = inputTokens;
        this.write(agentId, window);
    }

    /**
     * A call that was refused: whatever it named is the limit, and of the kind it named it in.
     *
     * A refusal that named nothing at all still has to leave something behind, and this is not a
     * nicety. Every way out of being refused for a history too long runs through a compaction, that
     * compaction sends the history to a summarizer, and the only thing that keeps the summarizer
     * from being refused over the very same history is a ceiling to trim it against. Learn nothing
     * here and the run is refused, sends the whole history, is refused again, three times, and gives
     * up -- and the next thing the user says starts that over, the conversation dead for good with
     * nothing to do but abandon it. So `estimated` is taken instead, which is what nothing else in
     * this file needs: a figure nobody named.
     */
    public static observeRefused(
        agentId: string, model: string, limit: OverflowLimit, estimated?: number
    ): void {
        const window = this.windowOf(agentId, model);
        let changed = false;
        if (limit.tokens !== undefined && window.upperTokens !== limit.tokens) {
            this.setCeiling(window, limit.tokens);
            changed = true;
        }
        if (limit.bytes !== undefined && window.bodyBytes !== limit.bytes) {
            window.bodyBytes = limit.bytes;
            changed = true;
        }
        if (!changed && limit.tokens === undefined && limit.bytes === undefined) {
            changed = this.narrowOnSilence(window, estimated);
        }
        if (changed) {
            this.write(agentId, window);
        }
    }

    /**
     * Reads a ceiling out of a refusal that named none, and says whether anything moved.
     *
     * The floor is preferred over the estimate wherever there is one, and it is the better figure
     * by a wide margin: a size the far end has actually answered at cannot be over the wall,
     * whereas an estimate is a division by three and could land either side of it. Too low is
     * survivable -- the run compacts sooner than it had to, and the first call that goes through
     * above the ceiling retires it -- and too high is the thing to avoid, being the case where the
     * summarizer is refused in turn and the whole conversation is lost.
     *
     * Where a ceiling already stands and none of this narrows it, it is cut by the margin anyway. A
     * second silent refusal under a ceiling that was supposed to prevent it means that ceiling was
     * wrong however it was arrived at, and a rule that can decline to move is a rule that can be
     * asked the same question three times and give up.
     */
    private static narrowOnSilence(window: LLMWindow, estimated?: number): boolean {
        const candidates = [estimated, window.lowerTokens].filter(
            (figure): figure is number => figure !== undefined && figure > 0
        );
        if (window.upperTokens !== undefined) {
            candidates.push(Math.floor(window.upperTokens * WINDOW_MARGIN));
        }
        const ceiling = Math.min(...candidates);
        if (!(ceiling > 0) || ceiling >= (window.upperTokens ?? Infinity)) {
            return false;
        }
        this.setCeiling(window, ceiling);
        return true;
    }

    /**
     * Puts the ceiling where it has just been read, and drops a floor that now stands above it.
     *
     * A floor over the ceiling is two claims that cannot both hold. The ceiling is the one to keep:
     * it comes from the refusal just now, and the floor from a call that went through at some point
     * before it, which is the older news of the two.
     */
    private static setCeiling(window: LLMWindow, tokens: number): void {
        window.upperTokens = tokens;
        if (window.lowerTokens !== undefined && window.lowerTokens >= tokens) {
            delete window.lowerTokens;
        }
    }

    /** Forgets what is held in memory. For tests, and for a config reloaded under a running app. */
    public static clear(): void {
        this.windows.clear();
    }

    private static pathOf(agentId: string): string {
        return `${AGENTS_DIR}/${agentId}/${AGENT_LLM_WINDOW_JSON}`;
    }

    private static read(agentId: string): LLMWindow | undefined {
        try {
            const parsed = JSON.parse(FileUtils.readFile(this.pathOf(agentId))) as LLMWindow;
            return typeof parsed?.model === 'string' ? parsed : undefined;
        } catch {
            // Never learned anything, or learned it into a file that no longer parses. Either way
            // there is nothing to go on, and learning it again costs one refused call.
            return undefined;
        }
    }

    /**
     * Writes through on every observation rather than at the end of the loop.
     *
     * The loop that learns a limit is the loop that most needs it: waiting for the next one to
     * start would spend this whole run refused a turn at a time. Two processes on one agent share
     * the file and the last write wins -- an observation lost that way is learned again the next
     * time, which is cheaper than anything that would prevent it. Within a process there is
     * nothing to lose, the loops working off one object in memory.
     */
    private static write(agentId: string, window: LLMWindow): void {
        try {
            FileUtils.writeFile(this.pathOf(agentId), JSON.stringify(window, null, 2));
        } catch {
            // Learning is an optimization. A run that cannot write it down still finishes.
        }
    }
}
