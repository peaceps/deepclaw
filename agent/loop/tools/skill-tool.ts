import { ToolDesc, ToolUseContext } from "../../definitions/tool-definitions.js";

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
    invoke: async function(input: SkillInput, context: ToolUseContext): Promise<string> {
        const { name } = input;
        return context.skillsManager.getSkillContent(name);
    },
}