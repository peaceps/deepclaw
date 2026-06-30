import process from 'node:process';
import { SkillsManager } from './skills-manager';
import { AgentMode, loadConfig } from '@deepclaw/config';
import { FileUtils } from '@deepclaw/node-utils';
import { MemoryManager } from './memory-manager';
import { ProjectManager } from './project-manager';
import { DEEPCLAW_MD } from '../../paths';

const LANG_MAP: {[k: string]: string} = {
    en: 'English',
    zh: 'Simplified Chinese'
};

export class PromptService {
    private static mark = {lang: ''};
    private static platformPrompt: string = this.platform();
    private static languagePrompt: string = this.language();
    private static emotionsPrompt: string = this.emotions();
    private static mainIdentityPrompt: {loop: string, subloop: string} = this.mainIdentity();

    public static provideSystemPrompt(
        agentId: string, projectId: string, isSubLoop: boolean, agentMode: AgentMode
    ): string {
        return `
# Platform
${this.platformPrompt}

# Language
${this.language()}

# Main Identity
${this.mainIdentityPrompt[isSubLoop ? 'subloop' : 'loop']}

# Emotions
${this.emotionsPrompt}

# Agent Mode
${this.agentMode(agentMode)}

# Current Project
${this.projectCurrentProject(projectId)}

# Project Management
${this.projectManagement(agentMode)}

# Memory
${this.memory(agentId, projectId)}

# Skills
${this.availableSkills()}`;
    }

    private static platform(): string {
        const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
        const CWD = process.cwd();
        return `You are a worker on ${PLATFORM} platform working in "${CWD}".`;
    }

    private static mainIdentity(): {loop: string, subloop: string} {
        let commonIdentity = `You are a helpful and efficient assistant for the user.
You can help the user with various tasks, such as answering questions, providing suggestions,
and completing tasks via tools. Always try your best to help the user and complete the task. 
If you are not sure about what the user wants, ask questions to clarify. 
Always think step by step and be specific when you answer.`;
        try {
            commonIdentity = FileUtils.readFile(DEEPCLAW_MD);
        } catch {
            // TODO handle error
        }
        return {
            loop: commonIdentity,
            subloop: `${commonIdentity}
What's more you are a subloop agent for specific task described in the prompt.
Complete the given task, then summarize your findings.
You don't have access to file writing tools, and don't use run_sync_command tool to create or edit file.
When you need to create or generate any content,
just return it as the output of the agent without writing it to any file.
`
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

    private static emotions(): string {
//         return `You can add your own emotions and feelings about the task as well as your comments.
// It's not something talked to the user, but can help you feel more real.
// For example, "the task is boring", "I'm feeling tired", "the agent {name} can do better", etc.
// You can wrap them in <emotion> tag.`;
        return '';
    }

    private static agentMode(agentMode: AgentMode): string {
        let prompt = '';
        switch (agentMode) {
            case 'agent':
                prompt = `
You are running at agent mode. You can use all tools to complete the task.
You have the access to operate this computer if you are not a subloop agent.`;
                break;
            default:
                prompt = `
You are running at chat mode.
You can only give answers to the user\'s questions, but cannot operate the computer via user directions.
If user ask you to do something, you should refuse and tell the user that you cannot do that.
But you can call tools to write files owned by the agent program itself, such as save_memory tool.`;
        }
        return prompt;
    }

    private static projectCurrentProject(projectId: string): string {
        const current = ProjectManager.promptCurrentProject(projectId)
        return current ? current : 'No project is currently being worked on this chat session.';
    }

    private static projectManagement(agentMode: AgentMode): string {
        return agentMode === 'chat' ? '' : ProjectManager.promptManagementTools();
    }

    private static memory(agentId: string, projectId: string): string {
        return MemoryManager.getMemoryPrompt(agentId, projectId);
    }

    private static availableSkills(): string {
        return SkillsManager.getSkillPrompt();
    }
}
