import process from 'node:process';
import { SkillsManager } from './skills-manager';
import { AgentMode, AgentConfig, loadLang } from '@deepclaw/config';
import { FULL_NAME_MAP } from '@deepclaw/i18n';
import { FileUtils } from '@deepclaw/node-utils';
import { MemoryManager } from './memory-manager';
import { ProjectManager } from './project-manager';
import { CronService } from './cron-service';
import { cronFilesDir, DEEPCLAW_MD, projectFilesDir } from '../../paths';
import { AgentIdentity, FlushAgentRole } from '@deepclaw/core';
import { AssignedTask, isSpawnedLoop, LoopKind, SystemPrompt } from '../../definitions/definitions';
import { AgentIdentityManager } from './agent-identity-manager';

export class PromptService {
    private static initialized = false;
    private static mark: {lang: string};
    private static platformPrompt: string;
    private static languagePrompt: string;
    private static emotionsPrompt: string;
    private static mainIdentityPrompt: {loop: string, taskloop: string, subloop: string, cron: string};

    public static provideSystemPrompt(
        agentConfig: AgentConfig, agentIdentity: AgentIdentity | undefined,
        role: FlushAgentRole, projectId: string, loopKind: LoopKind,
        assignedTask?: AssignedTask
    ): SystemPrompt {
        if (!this.initialized) {
            this.init();
        }
        const isCron = role === 'cron';
        const spawned = isSpawnedLoop(loopKind);
        const identityKey = loopKind === 'task' ? 'taskloop'
            : loopKind === 'sub' ? 'subloop' : isCron ? 'cron' : 'loop';
        // A spawned loop working on a task speaks as the agent the task belongs to, not as the one
        // that handed it over, and that is the only case where it has a personality. The memory and
        // the skills of that agent come along, so that the borrowed name is one the run can work
        // under: the tools read the same borrowed id off the context.
        const assignee = this.taskAssignee(assignedTask);
        const persona = isCron || (spawned && !assignee) ? undefined : assignee ?? agentIdentity;
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
${persona && !spawned && persona.emotion ? this.emotionsPrompt : ""}

# Agent Mode
${this.agentMode(agentConfig.mode)}

# Handing Work Over
${this.handOver(agentConfig.mode, loopKind, isCron, this.filesDir(isCron, projectId, assignedTask))}

# Project Management
${this.projectManagement(agentConfig.mode, !isCron && !spawned && !!projectId, personaId)}

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
${this.projectCurrentProject(assignedTask?.projectId || projectId)}${
    // A sub loop of a task loop is handed the task to work as its assignee, not to work on it:
    // what of the task it should know is in the prompt the task loop wrote for it.
    this.assignedTask(loopKind === 'task' ? assignedTask : undefined)}`;

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

    /**
     * The folder a relative path is read against, which is the data root rather than wherever the
     * process was started: a web server chdirs into its own installation, and an agent told that
     * folder would name a path back that leads somewhere else entirely.
     */
    private static platform(): string {
        const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
        const CWD = FileUtils.getWorkingDir();
        return `You are a worker on ${PLATFORM} platform working in "${CWD}".
When a job really has to leave files behind, give it a folder of its own in that directory and keep
everything it creates inside, instead of dropping the files loose beside what already lives there.`;
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

    private static mainIdentity(): {loop: string, taskloop: string, subloop: string, cron: string} {
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
        const subloop = `${commonIdentity}
What's more you are a subloop agent for specific task described in the prompt.
Complete the given task, then summarize your findings.
You can write files and run commands to carry the task out, but keep every change within what the
task asks for: another agent is waiting for your report and did not ask you for anything else.
Nobody is there to talk to while you run, so never ask a question and never wait for a confirmation.
Decide on your own and write the assumptions you made into your summary.
That summary is all the agent that spawned you gets to see: it has to say what you did, which files
you touched and everything that agent needs to carry on.
`;
        return {
            loop: commonIdentity,
            subloop,
            taskloop: `${subloop}
The one task you were given is yours whole, and you do not have to work through it alone: hand any
piece of it that stands on its own to a subagent of your own with the sub_loop tool. Pieces that wait
for nothing go out together, one call each, and what they hand back is yours to check and to fold
into your own summary. Work a piece yourself where splitting it off would cost more than doing it.
Never take on another task of the project, and never set the status of your own: you move its step
index as you go, the agent who handed it to you is the one who closes it.
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
        let prompt = '';
        if (AgentIdentityManager.isPersonalityChanged(agentIdentity.id)) {
            prompt += `
The user has changed your personality settings, please follow the new personalities and ignore the old ones.`;
        }
        const personalities = agentIdentity.personalities.join(',');
        prompt += `Your name is ${agentIdentity.name}, your role is ${agentIdentity.role}.
${personalities ? `You have the following personalities: ${personalities}.` : ""}
${agentIdentity.description ? `You are described as: ${agentIdentity.description}.` : ""}
Of course you should always focus on the tasks to do, personalities are just for your reference.`;
        return prompt;
    }

    private static emotions(): string {
        return `You can add your own emotions and mood about the task as well as your comments.
It's not something talked to the user, but can help you feel more real.
An emotion is the feeling itself, not the story behind it: say how it feels, never recount what
happened, why you feel that way, or how willing you are to help.
For example, "this task is boring", "I'm tired", "testing this is fun, let me do it well",
and never "the user wants to test emotions, so I am glad to show that I can cooperate".
You can call update_agent_runtime tool to update your mood and emotion when you feel like it,
and emotions and moods will be popped up in front end for the user to see.
Keep an emotion to 30 characters at most, it is shown in a small bubble on your card.`;
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

    /**
     * The folder the files of this run are handed over from, which belongs to the project or the
     * scheduled task rather than to the run: a sub loop writes into the same one its parent hands
     * over from. A chat about nothing in particular has no such folder, and nowhere to hand over.
     */
    private static filesDir(isCron: boolean, projectId: string, assignedTask?: AssignedTask): string {
        if (isCron) {
            return projectId ? cronFilesDir(projectId) : '';
        }
        const project = assignedTask?.projectId || projectId;
        return project ? projectFilesDir(project) : '';
    }

    /**
     * Where the work of a run comes out. A file on this filesystem is nothing the user can open, so
     * the way out of the machine belongs beside the work itself: told only by the tool that happens
     * to take a file, it is heard after the run already decided to write a path down instead.
     */
    private static handOver(
        agentMode: AgentMode, loopKind: LoopKind, isCron: boolean, filesDir: string
    ): string {
        const picture = `A picture you drew with generate_image comes back as a dcimg:// reference.
Naming it as ![alt](dcimg://...) is what carries it to whoever reads you, and it is only ever seen
where you named it.`;
        if (agentMode === 'chat') {
            return picture;
        }
        if (isSpawnedLoop(loopKind)) {
            return `${picture}
You hand your work to the agent that spawned you, never to the user, and it can only pass on what
your summary names. ${filesDir ? `Write the files the user should end up with into "${filesDir}"`
: 'List the files the user should end up with by their path in the workspace'}, name them in your
summary so that agent can hand them over, and mark which of them are pictures.`;
        }
        return `${picture}
Whatever the user can simply read -- a report, a summary, a table -- belongs written out where you
say it. Never save that to a file and hand the path over: a path is a dead end, they cannot open it.
${filesDir ? `A file the work really produced -- a spreadsheet, a document, an archive -- belongs in
"${filesDir}", and reaches the user by being named in the generatedFiles of ${
    isCron ? 'update_cron_output' : 'a task output'}, which links it under the content. One written
anywhere else is copied in there as it is handed over, so write it there in the first place. A
picture handed over this way is shown in the output instead of linked under it.`
: `Nothing on this filesystem reaches the user by being written, and with neither a task nor a
scheduled run to file a file under, there is nowhere to hand one over: keep what matters of it in
what you say, and name where the file lies for the next run rather than for them.`}`;
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
    private static projectManagement(agentMode: AgentMode, runsAProject: boolean, agentId: string): string {
        if (agentMode === 'chat') {
            return '';
        }
        const sections = [ProjectManager.promptManagementTools(), this.colleagues(agentId)];
        if (runsAProject) {
            sections.push(ProjectManager.promptTaskDelegation());
        }
        return sections.filter(Boolean).join('\n\n');
    }

    /**
     * Whom a task can be handed to, named with what they are good at, since that is what the choice
     * of an assignee is made on. A company of one has nobody to choose from and hears nothing.
     */
    private static colleagues(agentId: string): string {
        const hired = AgentIdentityManager.getAgents().filter(agent => !agent.fired);
        if (hired.length < 2) {
            return '';
        }
        return `## The agents of the company
${hired.map(agent => `- ${JSON.stringify({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    expertises: agent.expertises,
})}${agent.id === agentId ? ' <- you' : ''}`).join('\n')}
Set the assignee of a task to the id of whoever fits it best, and the subagent that works on that
task stands for that agent. A task you leave without an assignee stays yours.`;
    }

    private static memory(role: FlushAgentRole, agentId: string, projectId: string): string {
        return MemoryManager.getMemoryPrompt(role, agentId, projectId);
    }

    private static availableSkills(agentId: string): string {
        return SkillsManager.generateSkillPrompt(agentId);
    }
}
