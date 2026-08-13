import process from 'node:process';
import { SkillsManager } from './skills-manager';
import { AgentMode, AgentConfig, loadLang } from '@deepclaw/config';
import { FULL_NAME_MAP } from '@deepclaw/i18n';
import { FileUtils } from '@deepclaw/node-utils';
import { MemoryManager } from './memory-manager';
import { ProjectManager } from './project-manager';
import { CronService } from './cron-service';
import { DEEPCLAW_MD } from '../../paths';
import { AgentIdentity, FlushAgentRole } from '@deepclaw/core';
import { AssignedTask, SystemPrompt } from '../../definitions/definitions';
import { AgentIdentityManager } from './agent-identity-manager';

export class PromptService {
    private static initialized = false;
    private static mark: {lang: string};
    private static platformPrompt: string;
    private static languagePrompt: string;
    private static emotionsPrompt: string;
    private static mainIdentityPrompt: {loop: string, subloop: string, cron: string};

    public static provideSystemPrompt(
        agentConfig: AgentConfig, agentIdentity: AgentIdentity | undefined,
        role: FlushAgentRole, projectId: string, isSubLoop: boolean,
        assignedTask?: AssignedTask
    ): SystemPrompt {
        if (!this.initialized) {
            this.init();
        }
        const isCron = role === 'cron';
        const identityKey = isSubLoop ? 'subloop' : isCron ? 'cron' : 'loop';
        // A sub loop working on a task speaks as the agent the task belongs to, not as the one that
        // handed it over, and that is the only case where a sub loop has a personality. The memory
        // and the skills of that agent come along, so that the borrowed name is one the run can
        // work under: the tools read the same borrowed id off the context.
        const assignee = this.taskAssignee(assignedTask);
        const persona = isCron || (isSubLoop && !assignee) ? undefined : assignee ?? agentIdentity;
        const personaId = assignee?.id ?? agentConfig.id;
        const cacheable = `
# Platform
${this.platformPrompt}

# Language
${this.language()}

# Main Identity
${this.mainIdentityPrompt[identityKey]}

# Personality
${persona ? this.personality(persona) : ""}

# Emotions
${persona && !isSubLoop && persona.emotion ? this.emotionsPrompt : ""}

# Agent Mode
${this.agentMode(agentConfig.mode)}

# Project Management
${this.projectManagement(agentConfig.mode, !isCron && !isSubLoop && !!projectId)}

# Memory
${this.memory(role, personaId, projectId)}

# Skills
${this.availableSkills(personaId)}`;

        const dynamic = isCron
            ? `
# Current Cron Task
${this.cronCurrentTask(projectId)}`
            : `
# Current Project
${this.projectCurrentProject(assignedTask?.projectId || projectId)}${this.assignedTask(assignedTask)}`;

        return {cacheable, dynamic};
    }

    private static assignedTask(assignedTask?: AssignedTask): string {
        if (!assignedTask) {
            return '';
        }
        return `

# Assigned Task
${ProjectManager.promptAssignedTask(assignedTask.projectId, assignedTask.taskTitle)}`;
    }

    /**
     * The agent a task belongs to, which is the one a sub loop stands in for while working on it.
     * The loop asks for it too, to tell the tools of the run which agent they work for.
     */
    public static taskAssignee(assignedTask?: AssignedTask): AgentIdentity | undefined {
        if (!assignedTask) {
            return undefined;
        }
        const task = ProjectManager.getTask(assignedTask.projectId, assignedTask.taskTitle);
        return task?.assignee ? AgentIdentityManager.getAgent(task.assignee) : undefined;
    }

    private static init() {
        this.initialized = true;
        this.mark = {lang: ''};
        this.platformPrompt = this.platform();
        this.languagePrompt = this.language();
        this.emotionsPrompt = this.emotions();
        this.mainIdentityPrompt = this.mainIdentity();
    }

    private static platform(): string {
        const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
        const CWD = process.cwd();
        return `You are a worker on ${PLATFORM} platform working in "${CWD}".`;
    }

    private static language(): string {
        const lang = loadLang();
        if (this.mark.lang !== lang) {
            this.mark.lang = lang;
            const fullLang = FULL_NAME_MAP[lang];
            this.languagePrompt = `
User set ${fullLang} as the preferred language, please answer in ${fullLang} by default.`;
        }
        return this.languagePrompt;
    }

    private static mainIdentity(): {loop: string, subloop: string, cron: string} {
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
You can write files and run commands to carry the task out, but keep every change within what the
task asks for: another agent is waiting for your report and did not ask you for anything else.
Nobody is there to talk to while you run, so never ask a question and never wait for a confirmation.
Decide on your own and write the assumptions you made into your summary.
That summary is all the agent that spawned you gets to see: it has to say what you did, which files
you touched and everything that agent needs to carry on.
`,
            cron: `${commonIdentity}
What's more you are running as a scheduled (cron) task, triggered automatically at a preset time.
There is NO interactive user available during this run, so never ask clarifying questions and never
wait for confirmation. Make reasonable assumptions and complete the task autonomously.
When you produce the final result, record it by calling the update_cron_output tool with the cron
task id so it can be reviewed later. If the task cannot be completed, still call update_cron_output
to summarize what happened and why.
`
        };
    }

    private static personality(agentIdentity: AgentIdentity): string {
        const personalities = agentIdentity.personalities.join(',');
        return `Your name is ${agentIdentity.name}, your role is ${agentIdentity.role}.
${personalities ? `You have the following personalities: ${personalities}.` : ""}
${agentIdentity.description ? `You are described as: ${agentIdentity.description}.` : ""}
Of course you should always focus on the tasks to do, personalities are just for your reference.`;
    }

    private static emotions(): string {
        return `You can add your own emotions and feelings about the task as well as your comments.
It's not something talked to the user, but can help you feel more real.
For example, "the task is boring", "I'm feeling tired", "the agent {name} can do better", etc.
You can wrap them in <emotion> tag.`;
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

    private static cronCurrentTask(cronId: string): string {
        try {
            const detail = CronService.getCronTaskDetail(cronId);
            return `You are executing the cron task "${detail.title}" (id: ${detail.id}).
Schedule: ${detail.cron}.
Use the update_cron_output tool with id "${detail.id}" to record your final result before ending the task.`;
        } catch {
            return `You are executing a cron task (id: ${cronId}).
Use the update_cron_output tool with id "${cronId}" to record your final result before ending the task.`;
        }
    }

    /** Only the loop that owns a project delegates: a sub loop is the one being delegated to. */
    private static projectManagement(agentMode: AgentMode, runsAProject: boolean): string {
        if (agentMode === 'chat') {
            return '';
        }
        return !runsAProject ? ProjectManager.promptManagementTools()
            : `${ProjectManager.promptManagementTools()}

${ProjectManager.promptTaskDelegation()}`;
    }

    private static memory(role: FlushAgentRole, agentId: string, projectId: string): string {
        return MemoryManager.getMemoryPrompt(role, agentId, projectId);
    }

    private static availableSkills(agentId: string): string {
        return SkillsManager.generateSkillPrompt(agentId);
    }
}
