import { type AgentRuntimeStatus } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';

/** What an agent last said it felt, and how long ago that was. */
export type AgentFeeling = {
    mood?: AgentRuntimeStatus['mood'];
    emotion?: string;
    /** When it was said. What tells a feeling that went cold while nothing was happening. */
    saidAt: number;
    /** Turns of this agent since. What tells one that went cold while a great deal was. */
    turnsSince: number;
};

/**
 * When a run was last asked how it feels, in the same two measures.
 *
 * Kept because a question is only worth asking again after a while. A run that has nothing to say
 * about how it feels, or that would rather get on with the work, is entitled to that: asked every
 * turn it would either be nagged for the length of a run or answer every turn, and something felt
 * every turn is a bubble the user watches flicker rather than a feeling.
 *
 * One allowance per agent, as there is one feeling per agent: two loops of one agent running at
 * once -- a chat and a project, or a subagent off working a task in that agent's name -- ask out of
 * the same allowance and hear the answer of the other. One agent is one card, so a question about
 * that card is asked of the agent and not of a loop, and the last word on it belongs to whichever
 * run spoke last rather than to any one of them.
 */
export type AgentFeelingAsk = {
    askedAt: number;
    turnsSince: number;
};

/**
 * What every agent last said it felt, so that a run can be shown what it said last.
 *
 * The gateway keeps these feelings too, for the browsers to read, and this is not that copy: from
 * in here there is no gateway to ask, and what a prompt wants of a feeling is the one thing the
 * gateway has no use for -- how old it is. Nothing of this outlives the process, as nothing of a
 * mood should.
 *
 * Age is counted twice because a feeling goes stale two ways, and neither measure sees the other. A
 * chat left alone for an hour and a run that ground through thirty turns in five minutes have both
 * left the agent standing behind something it said in another life.
 */
class AgentFeelingServiceImpl {

    private static feelings: Map<string, AgentFeeling> = new Map();
    private static asks: Map<string, AgentFeelingAsk> = new Map();

    /**
     * Folded into what was said before, the way the gateway folds it: a run that says how it feels
     * and names no mood is in the mood it named last, and both travel together from here on.
     */
    public static remember(
        agentId: string, felt: {mood?: AgentRuntimeStatus['mood']; emotion?: string}
    ): void {
        const current = this.feelings.get(agentId);
        this.feelings.set(agentId, {
            mood: felt.mood ?? current?.mood,
            emotion: felt.emotion ?? current?.emotion,
            saidAt: Date.now(),
            turnsSince: 0,
        });
    }

    /** The question has been put to this agent, whatever it does about it. */
    public static asked(agentId: string): void {
        this.asks.set(agentId, {askedAt: Date.now(), turnsSince: 0});
    }

    /**
     * A turn of this agent has gone by, which ages what it said and the asking of it alike.
     *
     * Said by the loop of a turn rather than by whoever builds a prompt: a prompt is built for
     * other reasons than taking a turn -- a compaction, a preview -- and one of those would
     * otherwise age a feeling that nobody was shown.
     */
    public static aTurnPassed(agentId: string): void {
        const felt = this.feelings.get(agentId);
        if (felt) {
            felt.turnsSince++;
        }
        const ask = this.asks.get(agentId);
        if (ask) {
            ask.turnsSince++;
        }
    }

    /** Nothing where this agent has not felt anything yet. A copy, this being ours to age. */
    public static getFeeling(agentId: string): AgentFeeling | undefined {
        const felt = this.feelings.get(agentId);
        return felt ? {...felt} : undefined;
    }

    /** Nothing where the question has never been put, which is a question worth putting. */
    public static getAsk(agentId: string): AgentFeelingAsk | undefined {
        const ask = this.asks.get(agentId);
        return ask ? {...ask} : undefined;
    }
}

export const AgentFeelingService = globalize('AgentFeelingService', AgentFeelingServiceImpl);
