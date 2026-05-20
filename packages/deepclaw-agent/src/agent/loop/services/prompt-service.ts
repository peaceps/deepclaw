import process from 'node:process';
import fs from 'fs';
import { SkillsManager } from './skills-manager.js';
import { DeepclawConfig, loadConfig } from '@deepclaw/utils';
import { MemoryManager } from './memory-manager.js';

const LANG_MAP: {[k: string]: string} = {
    en: 'English',
    zh: 'Simplified Chinese'
};

export class PromptService {

    public static provideSystemPrompt(isSubLoop: boolean): string {
        return `${this.platform()}

${this.language()}

${this.mainIdentity(isSubLoop)}

${this.memory()}

${this.agentMode(isSubLoop)}

${this.availableSkills()}`;
    }

    private static platform(): string {
        const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
        const CWD = process.cwd();
        return `你是${PLATFORM}平台工作在"${CWD}"上的工作助手。`;
    }

    private static mainIdentity(isSubLoop: boolean): string {
        return !isSubLoop ? fs.readFileSync(loadConfig<string>('agent.identityFile'), 'utf8') : 
        `You are a subloop agent for specific task described in the prompt.
Complete the given task, then summarize your findings.
You don't have access to file writing tools, and don't use shell tool to create or edit file.
You have todo tool to manage your work if needed.
When you need to create or generate any content, just return it as the output of the agent without writing it to any file.`
    }

    private static language(): string {
        const lang = LANG_MAP[loadConfig<string>('ui.lang')];
        return `User set ${lang} as the preferred language, please answer in ${lang} by default.`;
    }

    private static agentMode(isSubLoop: boolean): string {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode');
        let prompt = '';
        switch (agentMode) {
            case 'agent':
                prompt = 'You are running at agent mode.';
                if (!isSubLoop) {
                    prompt += `
You can use all tools to complete the task. You have the access to operate this computer.`;
                }
                break;
            case 'plan':
                prompt = `
You are running at plan mode. You can use tools with read access to the filesystem,
but you cannot write to the filesystem or change the system state via user directions.
If user ask you to do something, you should refuse and tell the user that you cannot do that.
But you can call tools to write files owned by the agent program itself, such as save_memory tool.`;
                break;
            default:
                prompt = `
You are running at chat mode.
You can only give answers to the user\'s questions, but cannot operate the computer via user directions.
If user ask you to do something, you should refuse and tell the user that you cannot do that.
But you can call tools to write files owned by the agent program itself, such as save_memory tool.`;
                break;
        }
        return prompt;
    }

    private static memory(): string {
        return MemoryManager.getMemoryPrompt();
    }

    private static availableSkills(): string {
        return `Below available skills are not tools nor MCP tools, they cannot be used directly,
load_skill tool is a local function to get the detailed information of skills.
You always need to use load_skill tool with function_call first.

Skills available:
${SkillsManager.getAvailableSkills()}`;
    }
}
