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

type CreateSkillInput = {
    name: string;
    files: {path: string, content: string}[]
}

export const createSkillTool: ToolDesc<CreateSkillInput> = {
    tool: {
        name: 'create_skill',
        description: `Create a new reusable skill from the user's request.

A skill is a folder of files that teaches an agent how to perform a task. Generate
whatever files best fulfill the user's need (instructions, templates, scripts, data,
examples, etc.), but the folder MUST contain a "SKILL.md" entry file.

"SKILL.md" MUST start with a YAML frontmatter block declaring "name" and "description",
followed by the skill body in markdown. Example:
---
name: <skill-name>
description: "One sentence on what it does. Use when: <trigger keywords/phrases>."
---

# <Title>
<detailed instructions the agent should follow when the skill is loaded>

Rules:
- The frontmatter "name" MUST equal the "name" argument (a short kebab-case identifier).
- The "description" should clearly state when to use the skill so it can be matched later.
- Additional files are referenced by relative paths (e.g. "templates/report.md").
- Keep the body actionable; it becomes the agent's guidance when the skill is loaded.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: {
                    type: 'string',
                    description: 'Short kebab-case identifier for the skill, used as the folder name. Must match the "name" in SKILL.md frontmatter.'
                },
                files: {
                    type: 'array',
                    minItems: 1,
                    description: 'All files that make up the skill. Must include one file with path "SKILL.md".',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Relative file path within the skill folder, e.g. "SKILL.md" or "templates/report.md".'
                            },
                            content: {
                                type: 'string',
                                description: 'Full text content of the file.'
                            }
                        },
                        required: ['path', 'content']
                    }
                },
            },
            required: ['name', 'files'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    invoke: async function(input: CreateSkillInput, context: OneLoopContext): Promise<string> {
        const { name, files } = input;
        try {
            SkillsManager.installSkill(name, files);
        } catch (e) {
            return `Failed to create skill ${name}: ${e instanceof Error ? e.message : 'Unknown error'}`;
        }
        return `Skill ${name} created.
Available skills:
${SkillsManager.getAvailableSkillsPrompt(context.agentId)}`;
    },
}

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
