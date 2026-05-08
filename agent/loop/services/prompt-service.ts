import process from 'node:process';
import { SkillsManager } from './skills-manager.js';

const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
const CWD = process.cwd();

const DEFAULT_SYSTEM_PROMPT: SystemPrompt = {
    system: `You are a assistant agent on ${PLATFORM} at "${CWD}".
Use bash to inspect and change the workspace. Act first, then report clearly.

On each task begin, create a visible todo list with the todo tool before executing if the task should be done in multiple steps.
Use the todo tool for multi-step work.
Keep exactly one step inProgress when a task has multiple steps.
Refresh the plan as work advances. Prefer tools over prose.
When you are done, mark all the todo list as completed with the todo tool.

If you ask subagent to generate content, let subagent return the literal content as the output to you. And you do the file writing.

No matter what language the user is speaking or the skill is written in, always respond in simplified Chinese.`,

    subLoopSystem: `You are a assistant agent on ${PLATFORM} at "${CWD}".
Complete the given task, then summarize your findings.
You don't have access to file writing tools, and don't use shell tool to create or edit file.
You have todo tool to manage your work if needed.
When you need to create or generate any content, just return it as the output of the agent without writing it to any file.`,
};

export type SystemPrompt = {
    system: string;
    subLoopSystem: string;
}

export class PromptService {
    private prompts: SystemPrompt;

    constructor(system: SystemPrompt = DEFAULT_SYSTEM_PROMPT) {
        this.prompts = {
            system: this.appendAvailableSkills(system.system),
            subLoopSystem: this.appendAvailableSkills(system.subLoopSystem),
        }
    }

    public provideSystemPrompt(isSubLoop: boolean): string {
        return isSubLoop ? this.prompts.subLoopSystem : this.prompts.system;
    }

    private appendAvailableSkills(prompt: string): string {
        return `${prompt}

MCP server is not installed, do not use mcp_call.
IMPORTANT: You can only use local function calls, no mcp_calls.

Below available skills are not tools nor MCP tools, they cannot be used directly,
load_skill tool is a local function to get the detailed information of skills.
You always need to use load_skill tool with function_call first.

Skills available:
${SkillsManager.getAvailableSkills()}`;
    }
}