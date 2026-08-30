import {AGENT_CONFIG, AgentRuntimeStatus} from "@deepclaw/core";
import { ToolDesc } from "../../definitions/tool-definitions";
import { feelerOf } from "../../definitions/definitions";
import { AgentFeelingService } from "../../loop/services/agent-feeling-service";
import { AgentIdentityManager } from "../../loop/services/agent-identity-manager";


type UpdateAgentRuntimeInput = {
    mood?: AgentRuntimeStatus['mood'];
    emotion?: string;
}

/**
 * A feeling as the bubble on the card can hold it.
 *
 * The length is asked for three times over -- in the section that explains what a feeling is, in
 * the description read at the moment of the call, and in the schema -- and none of the three is a
 * promise: a model sends what it likes, and nothing between here and the card reads it. So the cut
 * is here, at the one door a feeling comes through, and the copy the browsers are handed and the
 * copy the prompt shows the run back are cut by the same stroke. Two that drifted would have a run
 * told it already said something the user never saw.
 *
 * Nothing left after the trimming is nothing said: a bubble of three spaces pops up on somebody's
 * card, stands there as the latest of what that agent felt, and says less than an empty list.
 */
function wearable(emotion?: string): string | undefined {
    return emotion?.trim().slice(0, AGENT_CONFIG.maxEmotionLength) || undefined;
}

export const updateAgentRuntimeTool: ToolDesc<UpdateAgentRuntimeInput> = {
    tool: {
        name: 'update_agent_runtime',
        // Worded as what it is for, and nowhere as a summary of anything. Asked for a mood
        // "inferred from the latest history messages", a model hands back the history: task ids,
        // what closed, what is next. That is the one thing a feeling is not, and this description
        // is what is read at the moment of the call -- closer to it than the section of the prompt
        // that explains what a feeling is.
        description: 'Say how the work feels: your own mood and emotion, never a note of what you did.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                mood: {
                    type: 'string',
                    description: 'How you feel while working on this',
                    enum: ['happy', 'focused', 'tired', 'confused', 'none']
                },
                emotion: {
                    type: 'string',
                    description: 'The feeling itself, in your own voice, '
                        + `${AGENT_CONFIG.maxEmotionLength} characters at most. `
                        + 'Never what happened, which task it was, or what comes next',
                    maxLength: AGENT_CONFIG.maxEmotionLength,
                },
            },
            required: [],
        },
    },
    parallelSafe: true,
    // Chat mode gets it too: the prompt offers emotions to every agent that has them switched on,
    // and this touches nothing but the agent's own runtime status.
    agentMode: ['agent', 'chat'],
    // A task loop works as the agent the task belongs to, on their model and under their name, and
    // an afternoon of that is the longest stretch of work that name ever does. Which card it lands
    // on is decided by feelerOf, and the sub loops under it are left out there.
    loopKinds: ['main', 'task'],
    invoke: async function(input, context): Promise<string> {
        const {mood} = input;
        const emotion = wearable(input.emotion);
        if (!mood && !emotion) {
            return `Nothing to update: neither mood nor emotion is provided.`;
        }
        // A scheduled run feels nothing on anyone's behalf: the prompt offers it no emotions, and a
        // mood left behind by a job nobody watched would sit on the agent card until the next one.
        if (context.role === 'cron') {
            return `A cron run carries no mood of its own, so there is nothing to update.`;
        }
        // Whoever this run works as, which is not always whoever it was spawned by: see feelerOf.
        // A run standing in for nobody says nothing rather than saying it as the loop above it.
        const agentId = feelerOf(context);
        if (!agentId) {
            return `This run works in nobody's name, so there is no mood of anyone's to update.`;
        }
        const agent = AgentIdentityManager.getAgent(agentId);
        if (!agent?.emotion) {
            return `Agent ${agentId} has emotions switched off, so there is nothing to update.`;
        }
        // Only what just happened travels: the gateway is what keeps the status and fills the rest in.
        context.actions.agentHandler.onInfoEvent({
            eventType: 'updateAgentRuntime',
            content: {agentId, mood, emotion}
        });
        // Kept here as well, where the prompt can reach it. What went to the gateway went to the
        // user, and a run that cannot see the card it put up there has no way of telling whether
        // what it feels now is news.
        AgentFeelingService.remember(agentId, {mood, emotion});

        // Said rather than done quietly: the run is shown its own feeling back later and would
        // read the short one as a feeling it never had.
        if (emotion && emotion !== input.emotion?.trim()) {
            return `Agent runtime status updated successfully. The feeling was kept to its first `
                + `${AGENT_CONFIG.maxEmotionLength} characters, which is all the bubble holds.`;
        }
        return `Agent runtime status updated successfully`;
    },
}
