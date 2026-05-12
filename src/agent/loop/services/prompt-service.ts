import process from 'node:process';
import fs from 'fs';
import { SkillsManager } from './skills-manager.js';
import { loadAgentConfig } from '@utils';

const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
const CWD = process.cwd();
const PLATFORM_PROMPT = `你是${PLATFORM}平台工作在"${CWD}"上的工作助手。`;

const SYSTEM_IDENTITY = fs.readFileSync(loadAgentConfig<string>('identityFile'), 'utf8');

const DEFAULT_SYSTEM_PROMPT: SystemPrompt = {
    system: `${PLATFORM_PROMPT}${SYSTEM_IDENTITY}`,

    subLoopSystem: `${PLATFORM_PROMPT}
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
