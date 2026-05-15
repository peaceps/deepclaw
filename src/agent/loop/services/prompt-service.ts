import process from 'node:process';
import fs from 'fs';
import { SkillsManager } from './skills-manager.js';
import { DeepclawConfig, loadAgentConfig } from '@utils';

export class PromptService {
    private static systemPrompt: string = this.combineSystemPrompt(false);
    private static subLoopSystemPrompt: string = this.combineSystemPrompt(true);

    public static provideSystemPrompt(isSubLoop: boolean): string {
        return isSubLoop ? this.subLoopSystemPrompt : this.systemPrompt;
    }

    private static combineSystemPrompt(isSubLoop: boolean): string {
        return `${this.platform()}

${this.mainIdentity(isSubLoop)}

${this.agentMode(isSubLoop)}

${this.availableSkills()}`;
    }

    private static platform(): string {
        const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
        const CWD = process.cwd();
        return `你是${PLATFORM}平台工作在"${CWD}"上的工作助手。`;
    }

    private static mainIdentity(isSubLoop: boolean): string {
        return !isSubLoop ? fs.readFileSync(loadAgentConfig<string>('identityFile'), 'utf8') : 
        `You are a subloop agent for specific task described in the prompt.
Complete the given task, then summarize your findings.
You don't have access to file writing tools, and don't use shell tool to create or edit file.
You have todo tool to manage your work if needed.
When you need to create or generate any content, just return it as the output of the agent without writing it to any file.`
    }

    private static agentMode(isSubLoop: boolean): string {
        const agentMode = loadAgentConfig<DeepclawConfig['agent']['mode']>('mode');
        let prompt = '';
        switch (agentMode) {
            case 'agent':
                prompt = 'You are running at agent mode.';
                if (!isSubLoop) {
                    prompt += ' You can use all tools to complete the task. You have the access to operate this computer.';
                }
                break;
            case 'plan':
                prompt = 'You are running at plan mode. You can use tools with read access to the filesystem, but you cannot write to the filesystem or change the system state. If user ask you to do something, you should refuse and tell the user that you cannot do that.';
                break;
            default:
                prompt = 'You are running at chat mode. You can only give answers to the user\'s questions, but cannot operate the computer. If user ask you to do something, you should refuse and tell the user that you cannot do that.';
                break;
        }
        return prompt;
    }

    private static availableSkills(): string {
        return `MCP server is not installed, do not use mcp_call.
IMPORTANT: You can only use local function calls, no mcp_calls.

Below available skills are not tools nor MCP tools, they cannot be used directly,
load_skill tool is a local function to get the detailed information of skills.
You always need to use load_skill tool with function_call first.

Skills available:
${SkillsManager.getAvailableSkills()}`;
    }
}
