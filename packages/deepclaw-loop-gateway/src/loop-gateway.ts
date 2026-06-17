import type { AgentHandler, AgentEmployee, AgentSoulIdentity, Project, Task, StandaloneTask, AgentInfoEvent } from "@deepclaw/core";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import type { DeepclawConfig } from "@deepclaw/config";

export type LoopStore = Record<string, LoopAgent<unknown, any, any>>;
export type LoopInfo = {agents: AgentEmployee[], projects: Project<Task>[]};

type LoopGatewayConstructor = typeof LoopGatewayImpl;

class LoopGatewayImpl {
    private static loops: LoopStore = {};
    private static subscribers: ((e: AgentInfoEvent) => void)[] = [];
    private static defaultHandler: AgentHandler = {
        onStreamText: () => {},
        onToolText: () => {},
        onInteractionEvent: () => Promise.resolve(''),
        onInfoEvent: (e) => LoopGatewayImpl.subscribers.forEach(cb => cb(e))
    };

    public static init(agentId: string, agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>>): void {
        this.loops[agentId] = LoopInitializer.getLoop(agentId, {
            onStreamText: agentHandler.onStreamText || this.defaultHandler.onStreamText,
            onToolText: agentHandler.onToolText || this.defaultHandler.onToolText,
            onInteractionEvent: agentHandler.onInteractionEvent || this.defaultHandler.onInteractionEvent,
            onInfoEvent: this.defaultHandler.onInfoEvent
        });
    }

    public static invoke(agentId: string, input: string): Promise<string> {
        if (!this.loops[agentId]) {
            this.init(agentId, {});
        }
        return this.loops[agentId]!.invoke(input);
    }

    public static updateLoopConfig(config: DeepclawConfig) {
        for (const agentConfig of config.agents) {
            if (!this.loops[agentConfig.id]) {
                continue;
            }
            this.loops[agentConfig.id]!.updateConfig(agentConfig);
        }
    }

    public static subscribe(cb: (e: AgentInfoEvent) => void): () => void {
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
        projects.projects.open.concat(projects.projects.closed).forEach(p => {
            res.push(ProjectManager.getProjectDetail(p.id));
        });
        projects.standaloneTasks.open.concat(projects.standaloneTasks.closed).forEach((t) => {
            const task = ProjectManager.getStandaloneTaskDetail(t.title);
            const project: Project<StandaloneTask> = ProjectManager.wrapStandaloneTask(task);
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

const globalForLoopGateway = globalThis as typeof globalThis & {
    __deepclawLoopGateway?: LoopGatewayConstructor;
};

export const LoopGateway = globalForLoopGateway.__deepclawLoopGateway ??= LoopGatewayImpl;
