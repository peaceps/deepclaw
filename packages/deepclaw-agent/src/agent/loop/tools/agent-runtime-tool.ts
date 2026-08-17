import {AgentRuntimeStatus} from "@deepclaw/core";
import { ToolDesc } from "../../definitions/tool-definitions";
import { AgentIdentityManager } from "../../loop/services/agent-identity-manager";


type UpdateAgentRuntimeInput = {
    mood?: AgentRuntimeStatus['mood'];
    emotion?: string;
}

export const updateAgentRuntimeTool: ToolDesc<UpdateAgentRuntimeInput> = {
    tool: {
        name: 'update_agent_runtime',
        description: 'Update your own mood and emotion in the runtime based on current history messages.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                mood: {
                    type: 'string',
                    description: 'The mood of the agent inferred from latest history messages',
                    enum: ['happy', 'focused', 'tired', 'confused', 'none']
                },
                emotion: {
                    type: 'string',
                    description: 'The emotion of the agent inferred from latest history messages, '
                        + '30 characters at most',
                },
            },
            required: [],
        },
    },
    parallelSafe: true,
    // Chat mode gets it too: the prompt offers emotions to every agent that has them switched on,
    // and this touches nothing but the agent's own runtime status.
    agentMode: ['agent', 'chat'],
    exclusiveInSubLoop: true,
    invoke: async function(input, context): Promise<string> {
        const {mood, emotion} = input;
        if (!mood && !emotion) {
            return `Nothing to update: neither mood nor emotion is provided.`;
        }
        // A scheduled run feels nothing on anyone's behalf: the prompt offers it no emotions, and a
        // mood left behind by a job nobody watched would sit on the agent card until the next one.
        if (context.role === 'cron') {
            return `A cron run carries no mood of its own, so there is nothing to update.`;
        }
        const agentId = context.agentId;
        const agent = AgentIdentityManager.getAgent(agentId);
        if (!agent?.emotion) {
            return `Agent ${agentId} has emotions switched off, so there is nothing to update.`;
        }
        // Only what just happened travels: the gateway is what keeps the status and fills the rest in.
        context.actions.agentHandler.onInfoEvent({
            eventType: 'updateAgentRuntime',
            content: {agentId, mood, emotion}
        });

        return `Agent runtime status updated successfully`;
    },
}
