import { ToolDesc } from "../../definitions/tool-definitions.js";
import { SkillsManager } from "../services/skills-manager.js";

type SkillInput = {
    name: string;
}

export const loadSkillTool: ToolDesc<SkillInput> = {
    tool: {
        name: 'load_skill',
        description: 'Load the full body of a named skill into the current context.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {name: {type: 'string'}},
            required: ['name'],
        },
    },
    agentMode: ['agent', 'plan', 'chat'],
    parallelSafe: true,
    invoke: async function(input: SkillInput): Promise<string> {
        const { name } = input;
        return SkillsManager.getSkillContent(name);
    },
}
