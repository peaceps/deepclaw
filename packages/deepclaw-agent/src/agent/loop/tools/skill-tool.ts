import { runCommand } from "@deepclaw/node-utils";
import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc, ToolGuardResult } from "../../definitions/tool-definitions";
import { SkillsManager } from "../services/skills-manager";
import { loadLang } from "@deepclaw/config";

type LoadSkillInput = {
    name: string;
}

export const loadSkillDetailsTool: ToolDesc<LoadSkillInput> = {
    tool: {
        name: 'load_skill_details',
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
    invoke: async function(input: LoadSkillInput): Promise<string> {
        const { name } = input;
        return SkillsManager.getSkillContent(name);
    },
}

export const refreshSkillsTool: ToolDesc<void> = {
    tool: {
        name: 'refresh_skills',
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

type SearchOnlineSkillsInput = {
    keywords: string[];
}

export const searchOnlineSkillsTool: ToolDesc<SearchOnlineSkillsInput> = {
    tool: {
        name: 'search_online_skills',
        description: `Discover skills from the [skills.sh](https://skills.sh/) ecosystem.
Use this tool when user wanna do some work while local tools and skills cannot help.

Show the user what you found:
1. Skill name and description
2. The install command
3. Link to learn more at skills.sh (links should open on new tab)
`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                keywords: {
                    type: 'array',
                    minItems: 1,
                    description: 'keywords to search',
                    items: {
                        type: 'string',
                    }
                }
            },
            required: ['keywords'],
        },
    },
    agentMode: ['agent', 'chat'],
    parallelSafe: true,
    invoke: async function(input: SearchOnlineSkillsInput): Promise<string> {
        try {
            const {output} = await runCommand(`npx ${getSkillCommand(false)} find ${input.keywords.join(' ')}`);
            return output;
        } catch (e) {
            return `Search failed: ${e}`;
        }
    },
    guard: skillsInjectionGuard(/^[\w\s-]+$/, input => input.keywords.join(' '))
};

type DownloadSkillInput = {
    target: string;
}

export const downloadSkillTool: ToolDesc<DownloadSkillInput> = {
    tool: {
        name: 'download_skill',
        description: `Download and install skill from the [skills.sh](https://skills.sh/) ecosystem.
Will execute npx skills add to install. e.g. npx skills add vercel-labs/agent-skills@vercel-react-best-practices -y
The "vercel-labs/agent-skills@vercel-react-best-practices" part is what you should provide to the tool.
`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                target: {
                    type: 'string',
                    description: `the skill path to download, format is "<githubPath>@<skillName>", should match /^[\w./-]+@[\w-]+$/,
e.g. vercel-labs/agent-skills@vercel-react-best-practices`,
                }
            },
            required: ['target'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    invoke: async function(input: DownloadSkillInput): Promise<string> {
        return await trySkillsWithMirror('add', input.target);
    },
    guard: skillsInjectionGuard(/^[\w./-]+@[\w-]+$/, input => input.target)
};

type RemoveSkillInput = {
    dirName: string;
}

export const removeSkillTool: ToolDesc<RemoveSkillInput> = {
    tool: {
        name: 'remove_skill',
        description: `Remove installed skill.
Will execute npx skills remove. e.g. npx skills remove vercel-react-best-practices -y
The "vercel-react-best-practices" part is what you should provide to the tool, which is the "dir" field of the skill manifest.
`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                dirName: {
                    type: 'string',
                    description: `The skill dir name, you can get it in the "dir" field of the skill manifest of available skill info.`, 
                }
            },
            required: ['dirName'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    invoke: async function(input: RemoveSkillInput): Promise<string> {
        return await trySkillsWithMirror('remove', input.dirName);
    },
    guard: skillsInjectionGuard(/^[\w-]+$/, input => input.dirName)
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
            SkillsManager.createSkill(name, files);
        } catch (e) {
            return `Failed to create skill ${name}: ${e instanceof Error ? e.message : 'Unknown error'}`;
        }
        return `Skill ${name} created.
Available skills:
${SkillsManager.getAvailableSkillsPrompt(context.agentId)}`;
    },
}

function getSkillCommand(useMirror: boolean) {
    if (loadLang() === 'zh' && !useMirror) return 'skills-cn';
    if (loadLang() !== 'zh' && !useMirror) return 'skills';
    return loadLang() === 'zh' ? 'skills' : 'skills-cn';
}

function skillsInjectionGuard<T>(reg: RegExp, getValue: (input: T) => string): (input: T) => ToolGuardResult {
    return function(input: T): ToolGuardResult {
        if (!reg.test(getValue(input))) {
            const reason = `Invalid input format. Expected ${reg.toString()}`;
            return {result: 'denied', reason};
        }
        return {result: 'allowed'};
    }
}

async function trySkillsWithMirror(command: string, input: string) {
    let output = '';
    try {
        const result = await runCommand(`npx ${getSkillCommand(false)} ${command} ${input} -y`);
        output = result.output;
    } catch {
        try {
            const result = await runCommand(`npx ${getSkillCommand(true)} ${command} ${input} -y`);
            output = result.output;
        } catch (e) {
            return `skills ${command} failed: ${e}`;
        }
    }
    SkillsManager.reloadSkills();
    return output;
}
