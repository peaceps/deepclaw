import process from 'node:process';
import { SkillsManager } from './skills-manager.js';
import { DeepclawConfig, loadConfig, FileUtils } from '@deepclaw/utils';
import { MemoryManager } from './memory-manager.js';
import { ProjectManager } from './project-manager.js';

const LANG_MAP: {[k: string]: string} = {
    en: 'English',
    zh: 'Simplified Chinese'
};

export class PromptService {
    private static mark = {lang: '', agentMode: ''};
    private static platformPrompt: string = this.platform();
    private static languagePrompt: string = this.language();
    private static mainIdentityPrompt: {loop: string, subloop: string} = this.mainIdentity();
    private static agentModePrompt: string = this.agentMode();

    public static provideSystemPrompt(isSubLoop: boolean): string {
        return `${this.platformPrompt}

${this.language()}

${this.mainIdentityPrompt[isSubLoop ? 'subloop' : 'loop']}

${this.agentMode()}

${this.memory()}

${this.availableSkills()}

${this.project()}`;
    }

    private static platform(): string {
        const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
        const CWD = process.cwd();
        return `You are a worker on ${PLATFORM} platform working in "${CWD}".`;
    }

    private static mainIdentity(): {loop: string, subloop: string} {
        const commonIdentity = `Use task tools to plan and track work, tasks will be persisted on local filesystem.
You have todo tool to manage each task if needed, todo items are transient and will be removed after the task is completed.`;
        return {
            loop: `${FileUtils.readFile(loadConfig<string>('agent.identityFile'))}

${commonIdentity}`,
            subloop: `You are a subloop agent for specific task described in the prompt.
Complete the given task, then summarize your findings.
You don't have access to file writing tools, and don't use shell tool to create or edit file.
When you need to create or generate any content,
just return it as the output of the agent without writing it to any file.

${commonIdentity}`
        };
    }

    private static language(): string {
        let lang = loadConfig<string>('ui.lang');
        lang = lang in LANG_MAP ? lang : 'en';
        if (this.mark.lang !== lang) {
            this.mark.lang = lang;
            const fullLang = LANG_MAP[lang];
            this.languagePrompt = `
User set ${fullLang} as the preferred language, please answer in ${fullLang} by default.`;
        }
        return this.languagePrompt;
    }

    private static agentMode(): string {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode', 'chat')!;
        if (this.mark.agentMode !== agentMode) {
            this.mark.agentMode = agentMode;
            let prompt = '';
            switch (agentMode) {
                case 'agent':
                    prompt = `
You are running at agent mode. You can use all tools to complete the task.
You have the access to operate this computer if you are not a subloop agent.`;
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
            }
            this.agentModePrompt = prompt;
        }
        return this.agentModePrompt;
    }

    private static memory(): string {
        return MemoryManager.getMemoryPrompt();
    }

    private static availableSkills(): string {
        return SkillsManager.getSkillPrompt();
    }

    private static project(): string {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode', 'chat')!;
        return agentMode === 'chat' ? '' : ProjectManager.prompts();
    }
}
