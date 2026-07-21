import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc } from "../../definitions/tool-definitions";
import { SkillsManager } from "../services/skills-manager";

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
    agentMode: ['agent', 'chat'],
    parallelSafe: true,
    invoke: async function(input: SkillInput): Promise<string> {
        const { name } = input;
        return SkillsManager.getSkillContent(name);
    },
}

export const refreshSkillTool: ToolDesc<void> = {
    tool: {
        name: 'refresh_skill',
        description: 'Refresh installed skills',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
        },
    },
    agentMode: ['agent', 'chat'],
    parallelSafe: true,
    invoke: async function(_: void, context: OneLoopContext): Promise<string> {
        SkillsManager.reloadSkills();
        return `Skills refreshed.
Available skills:
${SkillsManager.getAvailableSkillsPrompt(context.agentId)}`;
    },
};

type DeleteSkillInput = {
    name: string;
}
export const deleteSkillTool: ToolDesc<DeleteSkillInput> = {
    tool: {
        name: 'delete_skill',
        description: 'Delete a named skill',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {name: {type: 'string'}},
            required: ['name'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    invoke: async function(input: DeleteSkillInput, context: OneLoopContext): Promise<string> {
        const { name } = input;
        SkillsManager.deleteSkill(name);
        return `Skill ${name} deleted.
Available skills:
${SkillsManager.getAvailableSkillsPrompt(context.agentId)}`;
    },
}
