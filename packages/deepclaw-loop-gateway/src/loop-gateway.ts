import crypto from "crypto";
import { type FlushAgent, type AgentHandler, type AgentEmployee, AgentSoulIdentity } from "@deepclaw/core";
import { LoopInitializer, type Project, ProjectManager, StandaloneTask, AgentIdentityManager, type Task } from "@deepclaw/agent";

export type LoopStore = {agent: {[key: string]: FlushAgent}, project: {[key: string]: FlushAgent}};
export type LoopInfo = {agents: AgentEmployee[], projects: Project<Task>[]};

export class LoopGateway {
    
    private static loops: LoopStore = {
        agent: {}, project: {}
    };
    private static subscribers: (() => void)[] = [];
    private static defaultHandler: AgentHandler = {
        onStreamText: () => {},
        onToolText: () => {},
        onInteractionEvent: () => Promise.resolve(''),
        onInfoEvent: () => LoopGateway.subscribers.forEach(cb => cb())
    };

    public static init(type: keyof LoopStore, agentId: string, agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>>): void {
        this.loops[type][agentId] = LoopInitializer.getLoop(agentId, {
            onStreamText: agentHandler.onStreamText || this.defaultHandler.onStreamText,
            onToolText: agentHandler.onToolText || this.defaultHandler.onToolText,
            onInteractionEvent: agentHandler.onInteractionEvent || this.defaultHandler.onInteractionEvent,
            onInfoEvent: this.defaultHandler.onInfoEvent
        });
    }

    public static invoke(type: keyof LoopStore, agentId: string, input: string): Promise<string> {
        if (!this.loops[type][agentId]) {
            this.init(type, agentId, {});
        }
        return this.loops[type][agentId]!.invoke(input);
    }

    public static subscribe(cb: () => void): () => void {
        this.subscribers.push(cb);
        return () => {
            const index = this.subscribers.indexOf(cb);
            if (index !== -1) {
                this.subscribers.splice(index, 1);
            }
        };
    }

    public static newAgentIdentity(id: string): AgentEmployee {
        const identity = AgentIdentityManager.newAgentIdentity(id);
        return {
            ...identity,
            status: 'idle',
            mood: 'none',
            stats: {
                tasksCompleted: 0
            }
        };
    }

    public static updateAgentIdentity(id: string, identity: Partial<AgentSoulIdentity>): void {
        AgentIdentityManager.updateAgentIdentity(id, identity);
    }

    public static updateAgentDescription(id: string, description: string): void {
        AgentIdentityManager.updateAgentDescription(id, description);
    }

    public static getLoopInfo(): LoopInfo {
        const projects = this.getProjects();
        return {
            agents: this.getAgents(projects),
            projects,
        };
    }

    private static getProjects(): Project<Task>[] {
        const res: Project<Task>[] = [];
        const projects = ProjectManager.getProjectList(true);
        projects.projects.open.forEach(p => {
            res.push(ProjectManager.getProjectDetail(p.id));
        });
        projects.projects.closed.forEach(p => {
            res.push(ProjectManager.getProjectDetail(p.id));
        });
        projects.standaloneTasks.open.forEach((t, i) => {
            const task = ProjectManager.getStandaloneTaskDetail(t.title);
            const project: Project<StandaloneTask> = {
                id: `standalone-${i}`,
                title: t.title,
                description: '',
                tasks: {[t.title]: task},
                creator: task.creator,
                priority: task.priority || 'low',
                canStartTasks: [],
                ongoingTasks: [],
                completedTasks: [],
            }
            if (task.status === 'todo') {
                project.canStartTasks.push(task.title);
            } else if (task.status === 'ongoing') {
                project.ongoingTasks.push(task.title);
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
                creator: task.creator,
                priority: task.priority || 'low',
                createdAt: task.createdAt,
                closedAt: task.closedAt,
                canStartTasks: [],
                ongoingTasks: [],
                completedTasks: [],
            }
            project.completedTasks.push(task.title);
            res.push(project);
        });
        return res;
    }

    private static getAgents(projects: Project<Task>[]): AgentEmployee[] {
        return AgentIdentityManager.getAgents().map(agent => ({
            ...agent,
            status: agent.fired ? 'fired' : projects.some(p  => p.creator === agent.id && !p.closedAt) ? 'busy' : 'idle',
            mood: 'none',
            stats: {
                tasksCompleted: projects.filter(p => p.creator === agent.id && !!p.closedAt).length
            }
        }));
    }

}
