import type {
    AgentHandler, AgentEmployee, AgentSoulIdentity, Project, AgentInfoEvent,
    AgentStreamEvent
} from "@deepclaw/core";
import { globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";

export type LoopStore = Record<string, LoopAgent<unknown, any, any>>;
export type LoopInfo = {agents: AgentEmployee[], projects: Project[]};
export type SSEType = 'info' | 'loop';

class LoopGatewayImpl {
    private static loops: LoopStore = {};
    private static sseSubscribers: {[key in SSEType]: Set<
        (e: AgentInfoEvent | AgentStreamEvent) => void
    >} = {
        info: new Set(),
        loop: new Set()
    };
    private static defaultHandler: AgentHandler = {
        onStreamText: (e) => LoopGatewayImpl.sseSubscribers.loop.forEach(cb => cb(e)),
        onToolText: () => {},
        onInteractionEvent: () => Promise.resolve(''),
        onInfoEvent: (e) => LoopGatewayImpl.sseSubscribers.info.forEach(cb => cb(e))
    };

    public static init(agentId: string, agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>>): void {
        if (!this.loops[agentId]) {
            this.loops[agentId] = LoopInitializer.getLoop(agentId, {
                onStreamText: agentHandler.onStreamText || this.defaultHandler.onStreamText,
                onToolText: agentHandler.onToolText || this.defaultHandler.onToolText,
                onInteractionEvent: agentHandler.onInteractionEvent || this.defaultHandler.onInteractionEvent,
                onInfoEvent: this.defaultHandler.onInfoEvent
            });
        }
    }

    public static async invoke(agentId: string, projectId: string, input: string): Promise<string> {
        if (!this.loops[agentId]) {
            this.init(agentId, {});
        }
        return this.loops[agentId]!.invoke(`${agentId}.${projectId}`, input);
    }

    public static updateLoopConfig(config: DeepclawConfig) {
        for (const agentConfig of config.agents) {
            if (!this.loops[agentConfig.id]) {
                continue;
            }
            this.loops[agentConfig.id]!.updateConfig(agentConfig);
        }
    }

    public static subscribe(type: SSEType, cb: (e: AgentInfoEvent | AgentStreamEvent) => void): () => void {
        this.sseSubscribers[type].add(cb);
        return () => {
            this.sseSubscribers[type].delete(cb);
        };
    }

    public static newAgentIdentity(id: string): AgentEmployee {
        const identity = AgentIdentityManager.newAgentIdentity(id);
        return {
            ...identity,
            status: 'idle',
            mood: 'none',
            project: {
                todo: 0,
                ongoing: 0,
                done: 0
            }
        };
    }

    public static updateAgentIdentity(id: string, identity: Partial<AgentSoulIdentity>): void {
        AgentIdentityManager.updateAgentIdentity(id, identity);
    }

    public static updateAgentDescription(id: string, description: string): void {
        AgentIdentityManager.updateAgentDescription(id, description);
    }

    public static updateProjectTags(projectId: string, tags: string[]): Project {
        return ProjectManager.updateProjectTags(projectId, tags);
    }

    public static getLoopInfo(): LoopInfo {
        const projects = this.getProjects();
        return {
            agents: this.getAgents(projects),
            projects,
        };
    }

    private static getProjects(): Project[] {
        const res: Project[] = [];
        const projects = ProjectManager.getProjectList(true);
        projects.projects.open.concat(projects.projects.closed).forEach(p => {
            res.push(ProjectManager.getProjectDetail(p.id));
        });
        return res;
    }

    private static getAgents(projects: Project[]): AgentEmployee[] {
        const status: {[key: string]: {todo: number; ongoing: number; done: number}} = {};
        for (const project of projects) {
            if (!status[project.creator]) {
                status[project.creator] = {
                    todo: 0,
                    ongoing: 0,
                    done: 0
                }
            }
            if (!!project.closedAt) {
                status[project.creator]!.done++;
            } else if (project.ongoingTasks.length > 0) {
                status[project.creator]!.ongoing++;
            } else {
                status[project.creator]!.todo++;
            }
        }
        return AgentIdentityManager.getAgents().map(agent => {
            return {
                ...agent,
                status: agent.fired ? 'fired' :
                    (status[agent.id]?.ongoing || status[agent.id]?.todo) ? 'busy' : 'idle',
                mood: 'none',
                project: status[agent.id] || {todo: 0, ongoing: 0, done: 0}
            }
        });
    }
}

export const LoopGateway = globalize('LoopGateway', LoopGatewayImpl);
