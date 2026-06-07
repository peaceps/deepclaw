import crypto from "crypto";
import { type FlushAgent, type AgentHandler, type AgentIdentity } from "@deepclaw/core";
import { LoopInitializer, type Project, ProjectManager, StandaloneTask, type Task } from "@deepclaw/agent";
import { AgentEmployee } from "./loop-identity";

export class LoopGateway {
    private static instance: LoopGateway;
    private loop: FlushAgent;
    private subscribers: (() => void)[] = [];

    public static init(agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>>): LoopGateway {
        if (!this.instance) {
            this.instance = new LoopGateway(agentHandler);
        }
        return this.instance;
    }

    public static getProjects(): Project<Task>[] {
        const res: Project<Task>[] = [];
        const projects = ProjectManager.getProjectList(true);
        projects.projects.open.forEach(p => {
            res.push(ProjectManager.getProjectDetail(p.id));
        });
        projects.projects.closed.forEach(p => {
            res.push(ProjectManager.getProjectDetail(p.id));
        });
        projects.standaloneTasks.open.forEach(t => {
            const task = ProjectManager.getStandaloneTaskDetail(t.title);
            const project: Project<StandaloneTask> = {
                id: crypto.randomUUID(),
                title: t.title,
                description: '',
                tasks: {[t.title]: task},
                creator: 'main',
                canStartTasks: [],
                ongoingTasks: [],
                completedTasks: [],
            }
            if (task.status === 'todo') {
                project.canStartTasks!.push(task.title);
            } else if (task.status === 'ongoing') {
                project.ongoingTasks!.push(task.title);
            }
            res.push(project);
        });
        projects.standaloneTasks.closed.forEach(t => {
            const task = ProjectManager.getStandaloneTaskDetail(t.title);
            const project: Project<StandaloneTask> = {
                id: crypto.randomUUID(),
                title: t.title,
                description: '',
                tasks: {[t.title]: task},
                creator: 'main',
                canStartTasks: [],
                ongoingTasks: [],
                completedTasks: [],
            }
            project.completedTasks!.push(task.title);
            res.push(project);
        });
        return res;
    }

    public static getAgents(): AgentEmployee[] {
        if (!this.instance) {
            this.init({});
        }
        const agent: AgentIdentity = this.instance.loop.getIdentity();
        const e: AgentEmployee = {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            personality: agent.personality,
            skills: agent.skills,
            expertise: agent.expertise,
            
            avatar: '🦐',
            department: '技术部',
            status: 'busy',
            ownedProjects: [],
            mood: 'focused',
            stats: {
                tasksCompleted: 128,
            },
        };
        return [e];
    }

    public static subscribe(cb: () => void): () => void {
        if (!this.instance) {
            LoopGateway.init({});
        }
        this.instance.subscribers.push(cb);
        return () => {
            const index = this.instance.subscribers.indexOf(cb);
            if (index !== -1) {
                this.instance.subscribers.splice(index, 1);
            }
        };
    }

    private constructor(agentHandler: Partial<AgentHandler>) {
        const defaultHandler: AgentHandler = {
            onStreamText: () => {},
            onToolText: () => {},
            onInteractionEvent: () => Promise.resolve(''),
            onInfoEvent: () => LoopGateway.instance.subscribers.forEach(cb => cb())
        };
        this.loop = LoopInitializer.getLoop('main', {
            onStreamText: agentHandler.onStreamText || defaultHandler.onStreamText,
            onToolText: agentHandler.onToolText || defaultHandler.onToolText,
            onInteractionEvent: agentHandler.onInteractionEvent || defaultHandler.onInteractionEvent,
            onInfoEvent: agentHandler.onInfoEvent || defaultHandler.onInfoEvent
        });
    }

    public static invoke(input: string): Promise<string> {
        if (!this.instance) {
            LoopGateway.init({});
        }
        return this.instance.loop.invoke(input);
    }

}