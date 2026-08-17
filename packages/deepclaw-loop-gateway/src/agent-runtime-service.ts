import { type AgentRuntimeStatus } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';

/** The tail of the emotions one agent keeps, the older ones fall off the list. */
export const MAX_EMOTIONS = 20;

/**
 * How every agent feels at this very moment. Nothing of it is written down: a mood belongs to the
 * process that had it, and a fresh start deserves a fresh mood. It sits in the gateway, the one
 * place that both sees every event and answers a page that just loaded, so that all the tabs read
 * the same feelings whenever they happen to connect.
 */
class AgentRuntimeServiceImpl {

    private static status: Map<string, AgentRuntimeStatus> = new Map();

    /** Answers with the status as it stands afterwards, which is what the browsers are told about. */
    public static update(
        agentId: string, mood?: AgentRuntimeStatus['mood'], emotion?: string
    ): AgentRuntimeStatus {
        const current = this.getStatus(agentId);
        const emotions = emotion
            ? [...current.emotions ?? [], emotion].slice(-MAX_EMOTIONS)
            : current.emotions;
        const next: AgentRuntimeStatus = {mood: mood ?? current.mood, emotions};
        this.status.set(agentId, next);
        return next;
    }

    /** A neutral mood for an agent that has not felt anything yet, so callers always get a status. */
    public static getStatus(agentId: string): AgentRuntimeStatus {
        return this.status.get(agentId) ?? {mood: 'none', emotions: []};
    }
}

export const AgentRuntimeService = globalize('AgentRuntimeService', AgentRuntimeServiceImpl);
